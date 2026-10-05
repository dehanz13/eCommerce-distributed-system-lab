import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { ordering, prices } from '../apps/ordering/src/domain';
import { event } from '@lab/runtime/broker';
import { database } from './support/database';
import type { CheckoutInput } from '@lab/contracts';

let storage: Awaited<ReturnType<typeof database>>;
let shop: ReturnType<typeof ordering>;
let cartId: string;
let productId: string;
beforeAll(async () => {
  storage = await database('ordering');
  shop = ordering(storage.pool);
}, 20000);
afterAll(async () => storage.db.close());
beforeEach(async () => {
  await storage.db.exec(
    'TRUNCATE inbox,outbox,idempotency,order_items,orders,cart_items,carts,products CASCADE',
  );
  cartId = randomUUID();
  productId = randomUUID();
  await storage.pool.query(
    'INSERT INTO products(id,name,description,price_cents,available_stock) VALUES($1,$2,$3,125,5)',
    [productId, 'Notebook', 'Fictional item'],
  );
  await storage.pool.query('INSERT INTO carts(id,shopper_id) VALUES($1,$2)', [
    cartId,
    randomUUID(),
  ]);
  await storage.pool.query(
    'INSERT INTO cart_items(id,cart_id,product_id,quantity) VALUES($1,$2,$3,2)',
    [randomUUID(), cartId, productId],
  );
});
async function submission(): Promise<CheckoutInput> {
  const preview = await shop.preview(cartId);
  return { cartId, revision: preview.revision, priceFingerprint: preview.priceFingerprint };
}
const accept = (body: CheckoutInput, key: string = randomUUID()) =>
  shop.accept(body, key, randomUUID(), randomUUID());
it('reserves stock, snapshots items, empties the cart and records an event atomically', async () => {
  const preview = await shop.preview(cartId);
  expect(preview.totalCents).toBe(250);
  const order = await accept(await submission());
  expect(order).toMatchObject({
    status: 'accepted',
    totalCents: 250,
    items: [{ productId, name: 'Notebook', priceCents: 125, quantity: 2 }],
  });
  expect((await shop.products())[0]?.availableStock).toBe(3);
  expect(await shop.cart(cartId)).toMatchObject({ revision: 1, items: [] });
  const outbox = await storage.db.query<{ payload: { type: string; data: { orderId: string } } }>(
    'SELECT payload FROM outbox',
  );
  expect(outbox.rows).toMatchObject([
    { payload: { type: 'order.accepted', data: { orderId: order.id } } },
  ]);
  await storage.pool.query('UPDATE products SET name=$2,price_cents=900 WHERE id=$1', [
    productId,
    'Renamed',
  ]);
  expect((await shop.order(order.id)).items[0]).toMatchObject({
    name: 'Notebook',
    priceCents: 125,
  });
});
it('recovers an accepted response before checking the emptied cart and rejects key reuse', async () => {
  const body = await submission(),
    key = randomUUID();
  const original = await accept(body, key);
  expect(await accept(body, key)).toEqual(original);
  expect((await shop.products())[0]?.availableStock).toBe(3);
  await expect(accept({ ...body, revision: 1 }, key)).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
});
it('requires a bounded key and a known cart', async () => {
  const body = await submission();
  for (const key of ['', 'x'.repeat(121)])
    await expect(accept(body, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_REQUIRED' });
  await expect(accept({ ...body, cartId: randomUUID() })).rejects.toMatchObject({
    code: 'CART_NOT_FOUND',
  });
  await expect(shop.preview(randomUUID())).rejects.toMatchObject({ code: 'CART_NOT_FOUND' });
  await expect(shop.order(randomUUID())).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
});
it('scopes tracing references to the shopper even when two shoppers choose the same key', async () => {
  const first = await accept(await submission(), 'shared-fictional-key');
  const otherCart = randomUUID();
  await storage.pool.query('INSERT INTO carts(id,shopper_id) VALUES($1,$2)', [
    otherCart,
    randomUUID(),
  ]);
  await storage.pool.query(
    'INSERT INTO cart_items(id,cart_id,product_id,quantity) VALUES($1,$2,$3,1)',
    [randomUUID(), otherCart, productId],
  );
  const preview = await shop.preview(otherCart);
  const second = await accept(
    { cartId: otherCart, revision: preview.revision, priceFingerprint: preview.priceFingerprint },
    'shared-fictional-key',
  );
  expect(first.submissionReference).toMatch(/^[a-f0-9]{64}$/);
  expect(second.submissionReference).toMatch(/^[a-f0-9]{64}$/);
  expect(second.submissionReference).not.toBe(first.submissionReference);
});
it('requires reconfirmation after contents or price changes and keeps the cart', async () => {
  const body = await submission();
  await storage.pool.query('UPDATE carts SET revision=revision+1 WHERE id=$1', [cartId]);
  await expect(accept(body)).rejects.toMatchObject({ code: 'CART_CHANGED' });
  const changed = await submission();
  await storage.pool.query('UPDATE products SET price_cents=130 WHERE id=$1', [productId]);
  await expect(accept(changed)).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
  expect((await shop.cart(cartId)).items).toHaveLength(1);
  expect((await storage.db.query('SELECT id FROM orders')).rows).toHaveLength(0);
});
it('rejects empty, inactive and short-stock carts without a partial order', async () => {
  const body = await submission();
  await storage.pool.query('UPDATE products SET available_stock=1 WHERE id=$1', [productId]);
  await expect(accept(body)).rejects.toMatchObject({
    code: 'INSUFFICIENT_STOCK',
    details: [{ productId, availableStock: 1, active: true }],
  });
  await storage.pool.query('UPDATE products SET available_stock=5,active=false WHERE id=$1', [
    productId,
  ]);
  await expect(accept(body)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  expect((await shop.cart(cartId)).items).toHaveLength(1);
  await storage.pool.query('DELETE FROM cart_items WHERE cart_id=$1', [cartId]);
  await expect(accept(body)).rejects.toMatchObject({ code: 'EMPTY_CART' });
  expect((await storage.db.query('SELECT id FROM outbox')).rows).toHaveLength(0);
});
it('rolls back reservation, order and cart changes if saving the outgoing event fails', async () => {
  await storage.db.exec(
    "CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test storage failure'; END $$; CREATE TRIGGER reject_event BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION reject_event();",
  );
  try {
    await expect(accept(await submission())).rejects.toThrow('test storage failure');
    expect((await shop.products())[0]?.availableStock).toBe(5);
    expect((await shop.cart(cartId)).items).toHaveLength(1);
    expect((await storage.db.query('SELECT id FROM orders')).rows).toHaveLength(0);
    expect((await storage.db.query('SELECT key FROM idempotency')).rows).toHaveLength(0);
  } finally {
    await storage.db.exec('DROP TRIGGER reject_event ON outbox; DROP FUNCTION reject_event();');
  }
});
it('compensates once despite duplicate and contradictory terminal outcomes', async () => {
  const order = await accept(await submission());
  const failed = event(
    'fulfillment.failed',
    { orderId: order.id, fulfillmentId: randomUUID(), failureCode: 'SIMULATED_PROCESSING_FAILURE' },
    randomUUID(),
    randomUUID(),
  );
  await shop.consume(failed);
  await shop.consume(failed);
  await shop.consume({ ...failed, id: randomUUID() });
  await shop.consume(
    event(
      'fulfillment.completed',
      { orderId: order.id, fulfillmentId: randomUUID() },
      randomUUID(),
      randomUUID(),
    ),
  );
  expect((await shop.order(order.id)).status).toBe('failed');
  expect((await shop.products())[0]?.availableStock).toBe(5);
  await storage.pool.query('UPDATE products SET price_cents=200 WHERE id=$1', [productId]);
  const recovered = await shop.recover(order.id);
  expect(recovered.id).not.toBe(cartId);
  expect(recovered.items[0]).toMatchObject({ quantity: 2, priceCents: 200, availableStock: 5 });
});
it('fulfills once and refuses a recovery cart for accepted or fulfilled orders', async () => {
  const order = await accept(await submission());
  await expect(shop.recover(order.id)).rejects.toMatchObject({ code: 'ORDER_NOT_FAILED' });
  const completed = event(
    'fulfillment.completed',
    { orderId: order.id, fulfillmentId: randomUUID() },
    randomUUID(),
    randomUUID(),
  );
  await shop.consume(completed);
  await shop.consume(completed);
  expect((await shop.order(order.id)).status).toBe('fulfilled');
  expect((await shop.products())[0]?.availableStock).toBe(3);
});
it('does not permanently deduplicate an unknown-order outcome before its effects commit', async () => {
  const missing = event(
    'fulfillment.completed',
    { orderId: randomUUID(), fulfillmentId: randomUUID() },
    randomUUID(),
    randomUUID(),
  );
  await expect(shop.consume(missing)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  expect((await storage.db.query('SELECT id FROM inbox')).rows).toHaveLength(0);
});
it('fingerprints prices independently of item order without mutating the input', async () => {
  const item = (await shop.cart(cartId)).items[0]!;
  const items = [item, { ...item, productId: randomUUID(), priceCents: 200 }];
  const before = structuredClone(items);
  expect(prices(items)).toBe(prices([...items].reverse()));
  expect(items).toEqual(before);
});
