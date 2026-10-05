import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type pg from 'pg';
import type amqp from 'amqplib';
import { afterEach, expect, it, vi } from 'vitest';
import { event, broker } from '@lab/runtime/broker';
import { activity, readActivity, trace } from '@lab/runtime';

const transport = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: transport.connect } }));
afterEach(() => vi.clearAllMocks());

/** Provide only AMQP/SQL boundaries for the real broker adapter; no running services or developer records are touched. */
function fixture(failRecordingOnce = false) {
  const correlationId = randomUUID();
  const fact = event('order.accepted', { orderId: randomUUID() }, correlationId, randomUUID());
  let receive!: (message: amqp.ConsumeMessage) => Promise<void>;
  const channel = Object.assign(new EventEmitter(), {
    assertQueue: vi.fn(async () => {}),
    prefetch: vi.fn(async () => {}),
    consume: vi.fn(async (_queue: string, callback: typeof receive) => {
      receive = callback;
    }),
    sendToQueue: vi.fn(
      (
        _queue: string,
        _body: Buffer,
        _options: amqp.Options.Publish,
        confirmed: (error: Error | null) => void,
      ) => {
        confirmed(null);
        return true;
      },
    ),
    ack: vi.fn(),
    close: vi.fn(async () => {}),
  });
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: vi.fn(async () => channel),
    close: vi.fn(async () => {}),
  });
  transport.connect.mockResolvedValue(connection);
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('UPDATE outbox') && failRecordingOnce) {
      failRecordingOnce = false;
      throw new Error('Fixture outbox recording interrupted');
    }
    return {
      rows: sql.includes('SELECT count')
        ? [{ pending: 1, oldest: new Date() }]
        : sql.includes('SELECT id,payload')
          ? [{ id: fact.id, payload: fact }]
          : [],
    };
  });
  return {
    fact,
    correlationId,
    channel,
    query,
    pool: { query } as unknown as pg.Pool,
    deliver: (headers: Record<string, unknown>) =>
      receive({
        content: Buffer.from(JSON.stringify(fact)),
        properties: { headers },
        fields: {},
      } as amqp.ConsumeMessage),
  };
}

it('assigns distinct transport publication identities to retries of the same durable event', async () => {
  const source = fixture(true);
  const adapter = broker('ordering', source.pool, async () => {});
  try {
    await expect(adapter.tick()).rejects.toThrow('Fixture outbox recording interrupted');
    await adapter.tick();
    const headers = source.channel.sendToQueue.mock.calls.map((call) => call[2].headers ?? {});
    expect(headers[0]?.publicationId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(headers[1]?.publicationId).not.toBe(headers[0]?.publicationId);
    const publications = readActivity('ordering', source.correlationId).filter(
      (record) => record.type === 'event.publishing',
    );
    expect(publications.map((record) => record.eventId)).toEqual([source.fact.id, source.fact.id]);
    expect(new Set(publications.map((record) => record.publicationId))).toEqual(
      new Set(headers.map((header) => header.publicationId)),
    );
    const confirmations = readActivity('ordering', source.correlationId).filter(
      (record) => record.type === 'event.published',
    );
    expect(new Set(confirmations.map((record) => record.publicationId))).toEqual(
      new Set([headers[1]?.publicationId]),
    );
  } finally {
    await adapter.close();
  }
});

it('carries publication and distinct delivery identity through consumer processing and acknowledgment', async () => {
  const source = fixture();
  const contexts: unknown[] = [];
  const adapter = broker('fulfillment', source.pool, async () => {
    contexts.push(trace.getStore());
    activity('fulfillment', 'transaction.step', { step: 'fixture processing' });
  });
  const publicationId = randomUUID();
  try {
    await adapter.tick();
    await source.deliver({ publicationId });
    await source.deliver({ publicationId });
    const records = readActivity('fulfillment', source.correlationId);
    const receipts = records.filter((record) => record.type === 'event.received');
    expect(receipts).toHaveLength(2);
    expect(receipts[0]?.deliveryId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(receipts[1]?.deliveryId).not.toBe(receipts[0]?.deliveryId);
    for (const receipt of receipts) {
      const delivery = records.filter((record) => record.deliveryId === receipt.deliveryId);
      expect(delivery.map((record) => record.type)).toEqual([
        'event.acknowledged',
        'transaction.step',
        'event.received',
      ]);
      expect(delivery.every((record) => record.publicationId === publicationId)).toBe(true);
    }
    expect(contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ publicationId, deliveryId: expect.any(String) }),
      ]),
    );
    expect(source.channel.ack).toHaveBeenCalledTimes(2);
  } finally {
    await adapter.close();
  }
});

it('accepts legacy or malformed transport identity without trusting it as causal evidence', async () => {
  const source = fixture();
  const consume = vi.fn(async () => {});
  const adapter = broker('fulfillment', source.pool, consume);
  try {
    await adapter.tick();
    await source.deliver({});
    await source.deliver({ publicationId: 'untrusted-value' });
    expect(consume).toHaveBeenCalledTimes(2);
    const receipts = readActivity('fulfillment', source.correlationId).filter(
      (record) => record.type === 'event.received',
    );
    expect(receipts.every((record) => record.publicationId === undefined)).toBe(true);
    expect(receipts.every((record) => typeof record.deliveryId === 'string')).toBe(true);
  } finally {
    await adapter.close();
  }
});

it('retains receipt identity on deferred consumer work without claiming acknowledgment', async () => {
  const source = fixture();
  const publicationId = randomUUID();
  const adapter = broker('fulfillment', source.pool, async () => {
    throw new Error('Fixture consumer interruption');
  });
  try {
    await adapter.tick();
    await source.deliver({ publicationId });
    const records = readActivity('fulfillment', source.correlationId);
    const receipt = records.find((record) => record.type === 'event.received');
    expect(records.find((record) => record.type === 'event.deferred')).toMatchObject({
      publicationId,
      deliveryId: receipt?.deliveryId,
    });
    expect(source.channel.ack).not.toHaveBeenCalled();
  } finally {
    await adapter.close();
  }
});
