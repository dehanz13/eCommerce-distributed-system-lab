import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { fulfillment } from '../apps/fulfillment/src/domain';
import { event } from '@lab/runtime/broker';
import { database } from './support/database';
import type { PresetName } from '@lab/contracts';
let storage: Awaited<ReturnType<typeof database>>;
let worker: ReturnType<typeof fulfillment>;
let connected = true;
beforeAll(async () => {
  storage = await database('fulfillment');
}, 20000);
afterAll(async () => storage.db.close());
beforeEach(async () => {
  await storage.db.exec(
    "TRUNCATE inbox,outbox,attempts,jobs CASCADE; UPDATE settings SET preset='success',paused=false;",
  );
  connected = true;
  worker = fulfillment(storage.pool, () => connected);
});
async function enqueue(preset: PresetName = 'success') {
  await storage.pool.query('UPDATE settings SET preset=$1', [preset]);
  const accepted = event('order.accepted', { orderId: randomUUID() }, randomUUID(), randomUUID());
  await worker.consume(accepted);
  return accepted;
}
async function job() {
  return (
    await storage.db.query<{
      id: string;
      status: string;
      preset: string;
      attempt_number: number;
      next_attempt_at: Date;
    }>('SELECT * FROM jobs')
  ).rows[0]!;
}
// Drive persisted database deadlines without sleeping or mocking the processor.
async function due() {
  await storage.db.exec(
    "UPDATE attempts SET due_at=now()-interval '1 second'; UPDATE jobs SET next_attempt_at=now()-interval '1 second';",
  );
}
it('commits the inbox and one job, deduplicates delivery and snapshots the preset', async () => {
  const accepted = await enqueue('slow');
  await worker.consume(accepted);
  await worker.consume({ ...accepted, id: randomUUID() });
  await storage.db.exec("UPDATE settings SET preset='fail'");
  expect(await job()).toMatchObject({ status: 'queued', preset: 'slow', attempt_number: 0 });
  expect((await storage.db.query('SELECT id FROM jobs')).rows).toHaveLength(1);
  expect((await storage.db.query('SELECT id FROM inbox')).rows).toHaveLength(2);
});
it('does not spend processing attempts on dependency outages or a paused queue', async () => {
  await enqueue();
  connected = false;
  await worker.tick();
  expect((await job()).attempt_number).toBe(0);
  connected = true;
  await storage.db.exec('UPDATE settings SET paused=true');
  await worker.tick();
  expect((await job()).status).toBe('queued');
  await storage.db.exec('UPDATE settings SET paused=false');
  await worker.tick();
  expect(await job()).toMatchObject({ status: 'processing', attempt_number: 1 });
});
it('waits for the five-second deadline and resumes the same attempt after restart, even while paused', async () => {
  await enqueue('slow');
  await worker.tick();
  const timing = await storage.db.query<{ milliseconds: number }>(
    'SELECT extract(epoch FROM due_at-started_at)*1000 AS milliseconds FROM attempts',
  );
  expect(Number(timing.rows[0]?.milliseconds)).toBe(5000);
  await worker.tick();
  expect((await job()).status).toBe('processing');
  await storage.db.exec('UPDATE settings SET paused=true');
  await due();
  worker = fulfillment(storage.pool, () => true);
  await worker.tick();
  expect(await job()).toMatchObject({ status: 'completed', attempt_number: 1 });
  expect((await storage.db.query('SELECT id FROM attempts')).rows).toHaveLength(1);
  await worker.tick();
  expect((await storage.db.query('SELECT id FROM outbox')).rows).toHaveLength(1);
});
it('fails once, preserves a one-second retry deadline, then commits success and its event', async () => {
  const accepted = await enqueue('retry');
  await worker.tick();
  await due();
  await worker.tick();
  expect(await job()).toMatchObject({ status: 'retry_wait', attempt_number: 1 });
  const retry = await storage.db.query<{ seconds: number }>(
    'SELECT extract(epoch FROM next_attempt_at-updated_at) AS seconds FROM jobs',
  );
  expect(Number(retry.rows[0]?.seconds)).toBe(1);
  await worker.tick();
  expect((await job()).attempt_number).toBe(1);
  await due();
  await worker.tick();
  await due();
  await worker.tick();
  expect(await job()).toMatchObject({ status: 'completed', attempt_number: 2 });
  expect(
    (await storage.db.query('SELECT status,failure_code FROM attempts ORDER BY attempt_number'))
      .rows,
  ).toEqual([
    { status: 'failed', failure_code: 'SIMULATED_PROCESSING_FAILURE' },
    { status: 'completed', failure_code: null },
  ]);
  expect((await storage.db.query('SELECT payload FROM outbox')).rows).toMatchObject([
    {
      payload: {
        type: 'fulfillment.completed',
        causationId: accepted.id,
        correlationId: accepted.correlationId,
        data: { orderId: accepted.data.orderId, fulfillmentId: (await job()).id },
      },
    },
  ]);
});
it('exhausts exactly three attempts with one- and five-second retry delays', async () => {
  await enqueue('fail');
  for (let number = 1; number <= 3; number++) {
    await due();
    await worker.tick();
    expect((await job()).attempt_number).toBe(number);
    await due();
    await worker.tick();
    if (number < 3) {
      const delay = await storage.db.query<{ seconds: number }>(
        'SELECT extract(epoch FROM next_attempt_at-updated_at) AS seconds FROM jobs',
      );
      expect(Number(delay.rows[0]?.seconds)).toBe(number === 1 ? 1 : 5);
    }
  }
  expect(await job()).toMatchObject({ status: 'failed', attempt_number: 3 });
  await worker.tick();
  expect((await storage.db.query('SELECT id FROM attempts')).rows).toHaveLength(3);
  expect((await storage.db.query('SELECT payload FROM outbox')).rows).toMatchObject([
    {
      payload: {
        type: 'fulfillment.failed',
        data: { failureCode: 'SIMULATED_PROCESSING_FAILURE' },
      },
    },
  ]);
});
it('rolls back the final attempt and job if its outcome cannot be stored', async () => {
  await enqueue();
  await worker.tick();
  await due();
  await storage.db.exec(
    "CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test outcome failure'; END $$; CREATE TRIGGER reject_event BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION reject_event();",
  );
  try {
    await expect(worker.tick()).rejects.toThrow('test outcome failure');
    expect((await job()).status).toBe('processing');
    expect((await storage.db.query('SELECT status FROM attempts')).rows).toEqual([
      { status: 'processing' },
    ]);
  } finally {
    await storage.db.exec('DROP TRIGGER reject_event ON outbox; DROP FUNCTION reject_event();');
  }
  await worker.tick();
  expect((await job()).status).toBe('completed');
});
it('keeps at most one active attempt when multiple jobs wait', async () => {
  await enqueue();
  await enqueue();
  await worker.tick();
  await worker.tick();
  expect(
    (await storage.db.query("SELECT id FROM attempts WHERE status='processing'")).rows,
  ).toHaveLength(1);
  await due();
  await worker.tick();
  await worker.tick();
  expect((await storage.db.query('SELECT status FROM jobs ORDER BY status')).rows).toEqual([
    { status: 'completed' },
    { status: 'processing' },
  ]);
});
