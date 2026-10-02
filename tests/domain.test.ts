import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseEvent } from '@lab/contracts';
import { total, transition } from '../apps/ordering/src/policies';
import { outcome } from '../apps/fulfillment/src/policies';
describe('business guarantees', () => {
  it('uses integer money and rejects invalid quantities', () => {
    expect(
      total([
        { priceCents: 125, quantity: 3 },
        { priceCents: 0, quantity: 1 },
      ]),
    ).toBe(375);
    expect(() => total([{ priceCents: 1.5, quantity: 1 }])).toThrow();
    expect(() => total([{ priceCents: 10, quantity: 0 }])).toThrow();
  });
  it('has a bounded deterministic processing budget', () => {
    expect([1, 2, 3].map((n) => outcome('fail', n))).toEqual(['retry', 'retry', 'fail']);
    expect(outcome('retry', 2)).toBe('complete');
    expect(outcome('slow', 1)).toBe('complete');
  });
  it('never reverses terminal orders', () => {
    expect(transition('accepted', 'failed')).toBe(true);
    expect(transition('fulfilled', 'failed')).toBe(false);
    expect(transition('failed', 'fulfilled')).toBe(false);
  });
  it('rejects contradictory event payloads', () => {
    const base = {
      id: randomUUID(),
      type: 'fulfillment.failed',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      causationId: randomUUID(),
      data: { orderId: randomUUID() },
    };
    expect(() => parseEvent(base)).toThrow();
    expect(
      parseEvent({
        ...base,
        data: {
          ...base.data,
          fulfillmentId: randomUUID(),
          failureCode: 'SIMULATED_PROCESSING_FAILURE',
        },
      }).type,
    ).toBe('fulfillment.failed');
    expect(() =>
      parseEvent({
        ...base,
        type: 'order.accepted',
        data: { ...base.data, fulfillmentId: randomUUID() },
      }),
    ).toThrow();
  });
});
