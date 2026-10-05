import { telemetry } from '@lab/runtime/telemetry';
import { total, transition } from './policies';
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  type Product,
  type Cart,
  type CartItem,
  type Preview,
  type Order,
  type OrderItem,
  type CheckoutInput,
  type DomainEvent,
} from '@lab/contracts';
import { transaction, Problem, activity, trace } from '@lab/runtime';
import { row } from '@lab/runtime/rows';
import { event, saveEvent } from '@lab/runtime/events';
/** Fingerprint structured input with SHA-256; this is identity comparison, not authorization.
 * Input: s, from the caller’s structured domain value.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
const hash = (s: unknown) => createHash('sha256').update(JSON.stringify(s)).digest('hex');
/** Fingerprint sorted product prices for checkout reconfirmation.
 * Input: items, from the cart snapshot loaded by ordering before preview/acceptance.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export const prices = (items: CartItem[]) =>
  hash(
    [...items]
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .map((i) => [i.productId, i.priceCents]),
  );
/** Assemble the ordering module around its owned SQL transaction engine.
 * Input: p, from the application entry point: an injected ordering SQL pool.
 * Communicates with ordering PostgreSQL and transactional outbox; never fulfillment tables.
 */
export function ordering(p: pg.Pool) {
  const measurements = telemetry('ordering');
  /** Read one owned cart with current product snapshots.
   * Input: id, c, from validated ordering HTTP submissions or parsed outcome events.
   * Communicates with ordering PostgreSQL only; no reads of fulfillment tables.
   */
  async function cart(id: string, c: pg.Pool | pg.PoolClient = p): Promise<Cart> {
    const result = await c.query('SELECT * FROM carts WHERE id=$1', [id]);
    if (!result.rows[0]) throw new Problem(404, 'CART_NOT_FOUND', 'Cart does not exist');
    const items = await c.query(
      'SELECT ci.*,p.name,p.price_cents,p.available_stock,p.active FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE cart_id=$1 ORDER BY product_id',
      [id],
    );
    return { ...row<Cart>(result.rows[0]), items: items.rows.map((i) => row<CartItem>(i)) };
  }
  /** Read one owned order with immutable purchased-item snapshots.
   * Input: id, c, from validated ordering HTTP submissions or parsed outcome events.
   * Communicates with ordering PostgreSQL only; no reads of fulfillment tables.
   */
  async function order(id: string, c: pg.Pool | pg.PoolClient = p): Promise<Order> {
    const result = await c.query('SELECT * FROM orders WHERE id=$1', [id]);
    if (!result.rows[0]) throw new Problem(404, 'ORDER_NOT_FOUND', 'Order does not exist');
    const items = await c.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [id]);
    return { ...row<Order>(result.rows[0]), items: items.rows.map((i) => row<OrderItem>(i)) };
  }
  /** Observe current cart contents, prices and availability without reserving stock.
   * Input: id, from validated ordering HTTP submissions or parsed outcome events.
   * Communicates with ordering PostgreSQL only; no reads of fulfillment tables.
   */
  async function preview(id: string): Promise<Preview> {
    const x = await transaction(p, async (c) => {
      await c.query('SELECT id FROM carts WHERE id=$1 FOR UPDATE', [id]);
      return cart(id, c);
    });
    return {
      cartId: id,
      revision: x.revision,
      items: x.items,
      totalCents: total(x.items),
      priceFingerprint: prices(x.items),
      observedAt: new Date().toISOString(),
    };
  }
  /** Replay or atomically accept a confirmed checkout and stage its durable event.
   * Input: input, key, correlationId, requestId, from validated ordering HTTP submissions or parsed outcome events.
   * Communicates with ordering PostgreSQL and transactional outbox; never fulfillment tables.
   */
  async function accept(
    input: CheckoutInput,
    key: string,
    correlationId: string,
    requestId: string,
  ): Promise<Order> {
    if (!key || key.length > 120)
      throw new Problem(
        400,
        'IDEMPOTENCY_REQUIRED',
        'Supply an idempotency key of at most 120 characters',
      );
    let recovered = false;
    const result = await transaction(p, async (c) => {
      const found = await c.query('SELECT * FROM carts WHERE id=$1 FOR UPDATE', [input.cartId]);
      if (!found.rows[0]) throw new Problem(404, 'CART_NOT_FOUND', 'Cart does not exist');
      const shopperId = String(found.rows[0].shopper_id);
      // The key remains local to ordering. Its scope is part of the diagnostic identity.
      const submissionReference = hash(['checkout:v1', shopperId, key]);
      const context = trace.getStore();
      if (context) context.submissionReference = submissionReference;
      activity('ordering', 'checkout.submitted', {
        correlationId,
        requestId,
        submissionReference,
        stage: 'input',
      });
      const fingerprint = hash(input);
      const previous = await c.query('SELECT * FROM idempotency WHERE shopper_id=$1 AND key=$2', [
        shopperId,
        key,
      ]);
      if (previous.rows[0]) {
        if (previous.rows[0].fingerprint !== fingerprint)
          throw new Problem(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This key belongs to a different submission',
          );
        recovered = true;
        return previous.rows[0].response as Order;
      }
      const initial = await cart(input.cartId, c);
      if (initial.revision !== input.revision)
        throw new Problem(409, 'CART_CHANGED', 'Cart changed; refresh and confirm it again');
      if (!initial.items.length)
        throw new Problem(409, 'EMPTY_CART', 'Add a product before checking out');
      await c.query('SELECT id FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
        initial.items.map((i) => i.productId),
      ]);
      const current = await cart(input.cartId, c);
      if (prices(current.items) !== input.priceFingerprint)
        throw new Problem(409, 'PRICE_CHANGED', 'Prices changed; refresh and confirm them again');
      const invalid = current.items.filter((i) => !i.active || i.availableStock < i.quantity);
      if (invalid.length)
        throw new Problem(
          409,
          'INSUFFICIENT_STOCK',
          'Adjust the highlighted items and try again',
          invalid.map((i) => ({
            productId: i.productId,
            availableStock: i.availableStock,
            active: i.active,
          })),
        );
      const id = randomUUID();
      await c.query(
        "INSERT INTO orders(id,shopper_id,status,total_cents,correlation_id,submission_reference) VALUES($1,$2,'accepted',$3,$4,$5)",
        [id, shopperId, total(current.items), correlationId, submissionReference],
      );
      for (const item of current.items) {
        await c.query(
          'UPDATE products SET available_stock=available_stock-$2,updated_at=now() WHERE id=$1',
          [item.productId, item.quantity],
        );
        await c.query(
          'INSERT INTO order_items(id,order_id,product_id,name,price_cents,quantity) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), id, item.productId, item.name, item.priceCents, item.quantity],
        );
      }
      await c.query('DELETE FROM cart_items WHERE cart_id=$1', [input.cartId]);
      await c.query('UPDATE carts SET revision=revision+1,updated_at=now() WHERE id=$1', [
        input.cartId,
      ]);
      const result = await order(id, c);
      await c.query(
        'INSERT INTO idempotency(shopper_id,key,fingerprint,response) VALUES($1,$2,$3,$4)',
        [shopperId, key, fingerprint, result],
      );
      await saveEvent(
        c,
        event('order.accepted', { orderId: id }, correlationId, requestId, submissionReference),
      );
      return result;
    });
    activity('ordering', recovered ? 'checkout.recovered' : 'checkout.committed', {
      correlationId,
      requestId,
      orderId: result.id,
      submissionReference: result.submissionReference ?? trace.getStore()?.submissionReference,
    });
    measurements.operations.inc({
      operation: 'checkout',
      outcome: recovered ? 'recovered' : 'accepted',
    });
    if (!recovered)
      measurements.stock.inc(
        { reason: 'reservation', direction: 'decrease' },
        result.items.reduce((sum, item) => sum + item.quantity, 0),
      );
    return result;
  }
  /** Apply a validated event once and commit its owner effects.
   * Input: e, from validated ordering HTTP submissions or parsed outcome events.
   * Communicates with ordering PostgreSQL and transactional outbox; never fulfillment tables.
   */
  async function consume(e: DomainEvent) {
    let consumption = 'applied';
    let released = 0;
    await transaction(p, async (c) => {
      const existing = await c.query(
        'INSERT INTO inbox(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',
        [e.id],
      );
      if (!existing.rowCount) {
        consumption = 'duplicate';
        return;
      }
      const found = await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [e.data.orderId]);
      if (!found.rows[0])
        throw new Problem(404, 'ORDER_NOT_FOUND', 'Outcome references an unknown order');
      const next = e.type === 'fulfillment.completed' ? 'fulfilled' : 'failed';
      if (!transition(String(found.rows[0].status), next)) {
        consumption = 'terminal_ignored';
        return;
      }
      if (next === 'failed') {
        const items = await c.query(
          'SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_id',
          [e.data.orderId],
        );
        released = items.rows.reduce((sum, item) => sum + item.quantity, 0);
        for (const i of items.rows)
          await c.query(
            'UPDATE products SET available_stock=available_stock+$2,updated_at=now() WHERE id=$1',
            [i.product_id, i.quantity],
          );
      }
      await c.query(
        `UPDATE orders SET status=$2,updated_at=now(),${next === 'failed' ? 'failed_at' : 'fulfilled_at'}=$3 WHERE id=$1`,
        [e.data.orderId, next, e.occurredAt],
      );
    });
    measurements.consumption.inc({ outcome: consumption });
    if (released)
      measurements.stock.inc({ reason: 'compensation', direction: 'increase' }, released);
    activity('ordering', 'outcome.' + consumption, {
      orderId: e.data.orderId,
      eventId: e.id,
      correlationId: e.correlationId,
      submissionReference: e.submissionReference,
      eventType: e.type,
    });
  }
  /** Create fresh work from the retained original submission or failed-order history.
   * Input: id, from validated ordering HTTP submissions or parsed outcome events.
   * Communicates with ordering PostgreSQL and transactional outbox; never fulfillment tables.
   */
  async function recover(id: string) {
    const source = await order(id);
    if (source.status !== 'failed')
      throw new Problem(409, 'ORDER_NOT_FAILED', 'Only a failed order can create a recovery cart');
    const shopperId = randomUUID();
    const newId = randomUUID();
    await transaction(p, async (c) => {
      await c.query('INSERT INTO carts(id,shopper_id) VALUES($1,$2)', [newId, shopperId]);
      for (const i of source.items)
        await c.query(
          'INSERT INTO cart_items(id,cart_id,product_id,quantity) VALUES($1,$2,$3,$4)',
          [randomUUID(), newId, i.productId, i.quantity],
        );
    });
    return cart(newId);
  }
  return {
    cart,
    order,
    preview,
    accept,
    consume,
    recover,
    /** List the ordering-owned catalog records.
     * Input: no arguments; uses its current owner state, from validated ordering HTTP submissions or parsed outcome events.
     * Communicates with ordering PostgreSQL only; no reads of fulfillment tables.
     */
    products: async () =>
      (await p.query('SELECT * FROM products ORDER BY created_at,id')).rows.map((x) =>
        row<Product>(x),
      ),
  };
}
