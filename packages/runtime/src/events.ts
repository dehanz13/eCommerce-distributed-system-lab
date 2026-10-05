import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { parseEvent, type DomainEvent } from '@lab/contracts';

/** Transport-independent facts. The delivery adapter must retain these identifiers.
 * Input: type, data, correlationId, causationId, submissionReference, from the owner domain: event type, payload and retained identity.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function event(
  type: DomainEvent['type'],
  data: DomainEvent['data'],
  correlationId: string,
  causationId: string,
  submissionReference?: string,
): DomainEvent {
  return parseEvent({
    id: randomUUID(),
    type,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    correlationId,
    causationId,
    ...(submissionReference ? { submissionReference } : {}),
    data,
  });
}

/** Stage within the owner's transaction; never publish to a vendor before commit.
 * Input: c, e, from owner domain facts and the caller’s SQL transaction.
 * Communicates with shared event validation and the owner outbox; no broker connection.
 */
export async function saveEvent(c: pg.PoolClient, e: DomainEvent) {
  await c.query('INSERT INTO outbox(id,payload) VALUES($1,$2)', [e.id, e]);
}

/** Replacement transports drain the same owner outbox and invoke the same consumer. */
export interface EventDelivery {
  /** Drain the caller owner's committed outbox through the selected broker adapter; accepts no arguments. */
  tick(): Promise<void>;
  /** Return the adapter's cached connectivity; accepts no arguments and performs no new network probe. */
  status(): { connected: boolean };
  /** Release this adapter's owned broker connection when the application lifecycle requests shutdown. */
  close(): Promise<void>;
}
