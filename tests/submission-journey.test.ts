import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseEvent, validateReply } from '@lab/contracts';
import { event } from '@lab/runtime/events';
import { readActivity } from '@lab/runtime';
import { ordering } from '../apps/ordering/src/domain';
import { fulfillment } from '../apps/fulfillment/src/domain';
import { database } from './support/database';
import { journeys } from '../apps/web/lib/architecture-flow';
import type { ActivityRecord } from '@lab/contracts';

let orders: Awaited<ReturnType<typeof database>>;
let jobs: Awaited<ReturnType<typeof database>>;
beforeAll(async () => {
  orders = await database('ordering');
  jobs = await database('fulfillment');
}, 20000);
afterAll(async () => {
  await orders.db.close();
  await jobs.db.close();
});

it.each(['success', 'retry', 'fail'] as const)(
  'retains one scoped key reference through replay, worker restart and %s outcome',
  async (preset) => {
    const shop = ordering(orders.pool);
    const cartId = randomUUID();
    const productId = randomUUID();
    const shopperId = randomUUID();
    const key = 'private-replay-key-' + randomUUID();
    const correlationId = randomUUID();
    await orders.pool.query(
      'INSERT INTO products(id,name,description,price_cents,available_stock) VALUES($1,$2,$3,100,2)',
      [productId, 'Journey specimen', 'Fictional'],
    );
    await orders.pool.query('INSERT INTO carts(id,shopper_id) VALUES($1,$2)', [cartId, shopperId]);
    await orders.pool.query(
      'INSERT INTO cart_items(id,cart_id,product_id,quantity) VALUES($1,$2,$3,1)',
      [randomUUID(), cartId, productId],
    );
    const preview = await shop.preview(cartId);
    const body = { cartId, revision: preview.revision, priceFingerprint: preview.priceFingerprint };
    const accepted = await shop.accept(body, key, correlationId, randomUUID());
    const replayCorrelation = randomUUID();
    expect(await shop.accept(body, key, replayCorrelation, randomUUID())).toEqual(accepted);
    expect(accepted.submissionReference).toMatch(/^[a-f0-9]{64}$/);
    validateReply('/api/v1/checkouts', 'POST', {
      data: accepted,
      meta: { requestId: randomUUID(), correlationId, respondedAt: new Date().toISOString() },
    });
    const stored = await orders.pool.query(
      "SELECT payload FROM outbox WHERE payload->>'correlationId'=$1",
      [correlationId],
    );
    expect(stored.rows).toHaveLength(1);
    const fact = parseEvent(stored.rows[0].payload);
    expect(fact.submissionReference).toBe(accepted.submissionReference);
    await jobs.pool.query('UPDATE settings SET preset=$1', [preset]);
    let worker = fulfillment(jobs.pool, () => true);
    await worker.consume(fact);
    await worker.consume(fact);
    const recorded = await jobs.pool.query('SELECT * FROM jobs WHERE order_id=$1', [accepted.id]);
    expect(recorded.rows).toHaveLength(1);
    expect(recorded.rows[0].submission_reference).toBe(accepted.submissionReference);
    for (let number = 0; number < (preset === 'fail' ? 3 : preset === 'retry' ? 2 : 1); number++) {
      await jobs.pool.query('UPDATE jobs SET next_attempt_at=now() WHERE order_id=$1', [
        accepted.id,
      ]);
      await worker.tick();
      worker = fulfillment(jobs.pool, () => true);
      await jobs.db.exec("UPDATE attempts SET due_at=now()-interval '1 second'");
      await worker.tick();
    }
    const outcome = parseEvent(
      (
        await jobs.pool.query("SELECT payload FROM outbox WHERE payload->'data'->>'orderId'=$1", [
          accepted.id,
        ])
      ).rows[0].payload,
    );
    expect(outcome.submissionReference).toBe(accepted.submissionReference);
    expect(outcome.correlationId).toBe(correlationId);
    await shop.consume(outcome);
    await shop.consume(outcome);
    expect(await shop.order(accepted.id)).toMatchObject({
      submissionReference: accepted.submissionReference,
      status: preset === 'fail' ? 'failed' : 'fulfilled',
    });
    const activity = [...readActivity('ordering'), ...readActivity('fulfillment')];
    expect(JSON.stringify(activity)).not.toContain(key);
    const journey = journeys(activity as ActivityRecord[]).find(
      (x) => x.submissionReference === accepted.submissionReference,
    )!;
    expect(journey.correlationIds).toEqual(
      expect.arrayContaining([correlationId, replayCorrelation]),
    );
    expect(journey.logs.some((x) => x.type === 'outcome.applied')).toBe(true);
  },
);

it('accepts legacy events and rejects malformed or raw-key tracing metadata', () => {
  const legacy = event('order.accepted', { orderId: randomUUID() }, randomUUID(), randomUUID());
  expect(parseEvent(legacy).submissionReference).toBeUndefined();
  for (const reference of ['raw-key', 'A'.repeat(64), '', null])
    expect(() => parseEvent({ ...legacy, submissionReference: reference })).toThrow(
      'INVALID_EVENT',
    );
  expect(() => parseEvent({ ...legacy, idempotencyKey: 'raw-key' })).toThrow('INVALID_EVENT');
});
