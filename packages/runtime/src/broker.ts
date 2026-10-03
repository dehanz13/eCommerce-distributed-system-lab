import { telemetry } from './telemetry';
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { parseEvent, type DomainEvent } from '@lab/contracts';
import { cfg, activity, trace } from './index';
export const queues = { ordering: 'lab.outcomes', fulfillment: 'lab.accepted' };
export function event(
  type: DomainEvent['type'],
  data: DomainEvent['data'],
  correlationId: string,
  causationId: string,
): DomainEvent {
  return parseEvent({
    id: randomUUID(),
    type,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    correlationId,
    causationId,
    data,
  });
}
export async function saveEvent(c: pg.PoolClient, e: DomainEvent) {
  await c.query('INSERT INTO outbox(id,payload) VALUES($1,$2)', [e.id, e]);
}
// One publisher per owner. Confirmation loss may repeat delivery; consumers deduplicate.
export function broker(
  owner: 'ordering' | 'fulfillment',
  p: pg.Pool,
  consume: (e: DomainEvent) => Promise<void>,
) {
  const measurements = telemetry(owner);
  let connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  let channel: amqp.ConfirmChannel | null = null;
  let connecting = false;
  let ready = false;
  let publishing = false;
  let retryAt = 0;
  let lastWaiting = 0;
  let waitingMessage = '';
  let suppressedWaiting = 0;
  async function connect() {
    if (channel || connecting || Date.now() < retryAt) return;
    connecting = true;
    try {
      connection = await amqp.connect(
        `amqp://${encodeURIComponent(cfg.RABBIT_USER)}:${encodeURIComponent(cfg.RABBIT_PASSWORD)}@${cfg.RABBIT_CONNECT_HOST || cfg.RABBIT_HOST}:${cfg.RABBIT_CONNECT_PORT}`,
      );
      connection.on('error', () => {});
      connection.on('close', () => {
        channel = null;
        ready = false;
        retryAt = Date.now() + 1000;
      });
      const ch = await connection.createConfirmChannel();
      channel = ch;
      ch.on('error', () => {});
      ch.on('close', () => {
        channel = null;
        ready = false;
      });
      for (const q of [...Object.values(queues), 'lab.quarantine'])
        await ch.assertQueue(q, { durable: true });
      await ch.prefetch(1);
      await ch.consume(
        queues[owner],
        async (msg) => {
          if (!msg) return;
          let e: DomainEvent;
          try {
            e = parseEvent(JSON.parse(msg.content.toString()));
            if (
              (owner === 'ordering' && e.type === 'order.accepted') ||
              (owner === 'fulfillment' && e.type !== 'order.accepted')
            )
              throw new Error('WRONG_EVENT_OWNER');
          } catch {
            try {
              await new Promise<void>((resolve, reject) =>
                ch.sendToQueue(
                  'lab.quarantine',
                  msg.content,
                  { persistent: true, headers: { source: owner } },
                  (err) => (err ? reject(err) : resolve()),
                ),
              );
              ch.ack(msg);
              measurements.consumption.inc({ outcome: 'quarantined' });
              activity(owner, 'event.quarantined', {
                reason: 'INVALID_OR_WRONG_OWNER_CONTRACT',
                sourceQueue: queues[owner],
              });
            } catch {
              await connection?.close().catch(() => {});
            }
            return;
          }
          try {
            activity(owner, 'event.received', {
              eventId: e.id,
              eventType: e.type,
              orderId: e.data.orderId,
              correlationId: e.correlationId,
              causationId: e.causationId,
              input: e,
            });
            await trace.run(
              {
                owner,
                eventId: e.id,
                orderId: e.data.orderId,
                correlationId: e.correlationId,
                causationId: e.causationId,
              },
              () => consume(e),
            );
            ch.ack(msg);
            activity(owner, 'event.acknowledged', {
              eventId: e.id,
              eventType: e.type,
              orderId: e.data.orderId,
              correlationId: e.correlationId,
            });
          } catch (err) {
            measurements.consumption.inc({ outcome: 'deferred' });
            activity(owner, 'event.deferred', {
              eventId: e.id,
              correlationId: e.correlationId,
              message: String(err),
            });
            await connection?.close().catch(() => {});
          }
        },
        { noAck: false },
      );
      ready = true;
      activity(owner, 'broker.connected', { suppressed: suppressedWaiting });
      waitingMessage = '';
      suppressedWaiting = 0;
    } catch (e) {
      retryAt = Date.now() + 1000;
      await connection?.close().catch(() => {});
      connection = null;
      channel = null;
      ready = false;
      const message = String(e);
      if (message !== waitingMessage || Date.now() - lastWaiting >= 30000) {
        activity(owner, 'broker.waiting', { message, suppressed: suppressedWaiting });
        lastWaiting = Date.now();
        suppressedWaiting = 0;
      } else suppressedWaiting++;
      waitingMessage = message;
    } finally {
      connecting = false;
    }
  }
  async function publish() {
    await connect();
    if (!channel || !ready || publishing) return;
    publishing = true;
    try {
      const sample = await p.query(
        'SELECT count(*)::integer AS pending,min(created_at) AS oldest FROM outbox WHERE published_at IS NULL',
      );
      measurements.pending.set(sample.rows[0].pending);
      measurements.oldest.set(
        sample.rows[0].oldest
          ? Math.max(0, (Date.now() - new Date(sample.rows[0].oldest).getTime()) / 1000)
          : 0,
      );
      measurements.sampled.set(Date.now() / 1000);
      const rows = await p.query(
        'SELECT id,payload FROM outbox WHERE published_at IS NULL ORDER BY created_at,id LIMIT 20',
      );
      for (const row of rows.rows) {
        const e = parseEvent(row.payload);
        const ch = channel;
        if (!ch) break;
        const q = e.type === 'order.accepted' ? queues.fulfillment : queues.ordering;
        activity(owner, 'event.publishing', {
          eventId: e.id,
          correlationId: e.correlationId,
          causationId: e.causationId,
          eventType: e.type,
          input: e,
          destinationQueue: q,
          stage: 'process',
        });
        await new Promise<void>((resolve, reject) => {
          let returned = false;
          const onReturn = () => {
            returned = true;
          };
          ch.once('return', onReturn);
          ch.sendToQueue(
            q,
            Buffer.from(JSON.stringify(e)),
            { persistent: true, mandatory: true, messageId: e.id },
            (err) => {
              ch.removeListener('return', onReturn);
              if (err || returned) reject(err ?? new Error('UNROUTABLE_EVENT'));
              else resolve();
            },
          );
        });
        await p.query('UPDATE outbox SET published_at=now() WHERE id=$1', [e.id]);
        measurements.publication.inc({ outcome: 'confirmed' });
        activity(owner, 'event.published', {
          eventId: e.id,
          correlationId: e.correlationId,
          eventType: e.type,
          orderId: e.data.orderId,
          causationId: e.causationId,
          destinationQueue: q,
          output: { confirmed: true, outboxRecorded: true },
        });
      }
    } catch (error) {
      measurements.publication.inc({ outcome: 'failed' });
      throw error;
    } finally {
      publishing = false;
    }
  }
  return {
    tick: publish,
    status: () => ({ connected: ready }),
    close: async () => {
      await connection?.close();
    },
  };
}
