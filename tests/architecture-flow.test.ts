import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ActivityRecord } from '@lab/contracts';
import {
  records,
  isStale,
  activityEdge,
  journeyHops,
  journeyOutcome,
  journeys,
  observedActivity,
  pieceHealth,
} from '../apps/web/lib/architecture-flow';
const correlationId = randomUUID();
let sequence = 0;
function log(type: string, owner = 'ordering', data: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: randomUUID(),
    owner,
    type,
    occurredAt: new Date(1700000000000 + sequence++ * 100).toISOString(),
    correlationId,
    ...data,
  };
}
const accepted = () => [
  log('http.received', 'ordering', { route: '/api/v1/checkouts', method: 'POST' }),
  log('checkout.committed'),
  log('http.completed', 'ordering', { status: 200, route: '/api/v1/checkouts' }),
  log('event.published', 'ordering', { eventType: 'order.accepted' }),
  log('event.received', 'fulfillment'),
  log('job.recorded', 'fulfillment'),
];
it('maps cache observations, operator controls and uncertain health without inventing hops', () => {
  expect(records([null, [], 'bad', { id: 'valid' }])).toEqual([{ id: 'valid' }]);
  expect(records(null)).toEqual([]);
  const now = Date.now(),
    at = new Date(now).toISOString();
  expect(isStale({ at: 'invalid' }, now, true)).toBe(true);
  expect(pieceHealth('redis', { cache: { at, data: { connected: true } } }, now, true)).toBe(
    'ready',
  );
  expect(pieceHealth('redis', { cache: { at, data: { connected: false } } }, now, true)).toBe(
    'unavailable',
  );
  expect(pieceHealth('redis', {}, now, true)).toBe('unknown');
  expect(pieceHealth('redis', { cache: { at, error: 'offline' } }, now, true)).toBe('stale');
  const status = {
    at,
    data: {
      services: [
        { name: 'fulfillment', reachable: true, ready: true, broker: true },
        { name: 'ordering', reachable: true, ready: true, broker: false },
      ],
    },
  };
  expect(
    pieceHealth(
      'fulfillment',
      { status, fulfillment: { at, data: { settings: { paused: true } } } },
      now,
      true,
    ),
  ).toBe('paused');
  expect(pieceHealth('rabbitmq', { status }, now, true)).toBe('degraded');
  expect(pieceHealth('web', { status }, now, true)).toBe('unavailable');
  expect(pieceHealth('ordering', { status: { at, error: 'offline' } }, now, true)).toBe('stale');
  const logs = [
    log('http.received', 'ordering', { method: 'GET', route: '/api/v1/products' }),
    log('cache.database'),
    log('cache.hit'),
    log('http.completed', 'ordering', { status: 200 }),
  ];
  const trace = journeys(logs)[0]!;
  expect(journeyHops(trace).map((x) => x.edge)).toEqual([
    'request',
    'ordering-write',
    'cache',
    'response',
  ]);
  expect(journeyOutcome(trace)).toBe('HTTP activity');
  const completed = journeys([
    log('outcome.applied', 'ordering', { eventType: 'fulfillment.completed' }),
  ])[0]!;
  expect(journeyOutcome(completed)).toBe('fulfilled');
  expect(activityEdge(log('cache.hit'))).toBe('cache');
  expect(activityEdge(log('cache.database'))).toBe('ordering-write');
  expect(activityEdge(log('http.received', 'operator'))).toBe('control');
  expect(activityEdge(log('http.received', 'fulfillment'))).toBeUndefined();
  expect(activityEdge(log('http.completed', 'fulfillment'))).toBeUndefined();
  expect(activityEdge(log('checkout.recovered'))).toBe('ordering-write');
  expect(activityEdge(log('event.published', 'ordering'))).toBe('accepted');
  expect(activityEdge(log('event.published', 'fulfillment'))).toBe('outcome');
  expect(activityEdge(log('event.acknowledged', 'fulfillment'))).toBe('delivery');
  expect(activityEdge(log('event.received', 'ordering'))).toBe('outcome-delivery');
  expect(activityEdge(log('unrelated'))).toBeUndefined();
});
describe('observed architecture journeys', () => {
  it('joins replay requests by scoped reference and leaves ambiguous correlation-only logs separate', () => {
    const reference = 'a'.repeat(64);
    const replay = randomUUID();
    const flows = journeys([
      log('http.received'),
      log('checkout.committed', 'ordering', { submissionReference: reference }),
      log('http.received', 'ordering', { correlationId: replay }),
      log('checkout.recovered', 'ordering', {
        correlationId: replay,
        submissionReference: reference,
      }),
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0]?.logs).toHaveLength(4);
    expect(flows[0]?.correlationIds).toEqual([correlationId, replay]);
    const ambiguous = journeys([
      log('http.received'),
      log('checkout.committed', 'ordering', { submissionReference: reference }),
      log('checkout.committed', 'ordering', { submissionReference: 'b'.repeat(64) }),
    ]);
    expect(ambiguous).toHaveLength(3);
    expect(new Set(ambiguous.map((x) => x.id)).size).toBe(3);
  });
  it('does not infer unobserved work from an accepted response or missing activity', () => {
    const trace = journeys(accepted())[0]!;
    expect(journeyHops(trace).filter((x) => x.observation)).toHaveLength(6);
    expect(journeyHops(trace).find((x) => x.id === 'terminal')?.observation).toBeUndefined();
    expect(journeyOutcome(trace)).toBe('Awaiting observed outcome');
  });
  it('keeps retries as activity until a terminal attempt and compensation are observed', () => {
    const logs = [
      ...accepted(),
      log('attempt.started', 'fulfillment'),
      log('attempt.finished', 'fulfillment', { outcome: 'retry' }),
    ];
    expect(
      journeyHops(journeys(logs)[0]!).find((x) => x.id === 'processed')?.observation,
    ).toBeUndefined();
    logs.push(
      log('attempt.finished', 'fulfillment', { outcome: 'fail' }),
      log('event.published', 'fulfillment', { eventType: 'fulfillment.failed' }),
      log('event.received', 'ordering'),
      log('outcome.applied', 'ordering', { eventType: 'fulfillment.failed' }),
    );
    const trace = journeys(logs)[0]!;
    expect(journeyHops(trace).every((x) => x.observation)).toBe(true);
    expect(journeyOutcome(trace)).toBe('failed · stock released');
  });
  it('shows a rejected checkout without inventing an order or database milestone', () => {
    const trace = journeys([
      log('http.received', 'ordering', { route: '/api/v1/checkouts' }),
      log('http.completed', 'ordering', { route: '/api/v1/checkouts', status: 409 }),
    ])[0]!;
    expect(journeyHops(trace)).toHaveLength(2);
    expect(journeyOutcome(trace)).toBe('HTTP 409 · request rejected');
    expect(journeyHops(trace).map((x) => x.edge)).toEqual(['request', 'response']);
  });
  it('deduplicates overlapping activity snapshots and preserves correlation separation', () => {
    const item = log('job.recorded', 'fulfillment');
    const other = log('http.received', 'ordering', {
      correlationId: randomUUID(),
      route: '/api/v1/products',
      method: 'GET',
    });
    const list = observedActivity({
      orderingLogs: { data: [other] },
      fulfillmentLogs: { data: [item, item, {}] },
    });
    expect(list).toHaveLength(2);
    expect(journeys(list)).toHaveLength(2);
    expect(activityEdge(item)).toBe('fulfillment-write');
  });
  it('does not evict a checkout merely because unrelated reads are newer', () => {
    const logs = accepted();
    for (let index = 0; index < 50; index++)
      logs.push(
        log('http.received', 'ordering', {
          correlationId: randomUUID(),
          route: '/api/v1/orders',
          method: 'GET',
        }),
      );
    expect(journeys(logs).find((x) => x.id === correlationId)?.checkout).toBe(true);
  });
  it('never treats stale cached readiness or an unreachable owner as proof of database health', () => {
    const now = Date.now();
    const samples = {
      status: {
        at: new Date(now).toISOString(),
        data: {
          services: [
            { name: 'ordering', reachable: true, ready: false, database: true, broker: false },
            { name: 'fulfillment', reachable: false },
          ],
        },
      },
    };
    expect(pieceHealth('ordering', samples, now, true)).toBe('degraded');
    expect(pieceHealth('ordering-db', samples, now, true)).toBe('ready');
    expect(pieceHealth('fulfillment-db', samples, now, true)).toBe('unknown');
    expect(pieceHealth('rabbitmq', samples, now, true)).toBe('unavailable');
    expect(pieceHealth('ordering-db', samples, now + 11000, true)).toBe('stale');
    expect(pieceHealth('ordering', samples, now, false)).toBe('stale');
  });
});
it('matches checkout HTTP observations within a larger shopper correlation', () => {
  const browserRequest = randomUUID(),
    checkoutRequest = randomUUID();
  const logs = [
    log('http.received', 'ordering', { route: '/api/v1/products', requestId: browserRequest }),
    log('http.completed', 'ordering', {
      route: '/api/v1/products',
      requestId: browserRequest,
      status: 200,
    }),
    log('http.received', 'ordering', { route: '/api/v1/checkouts', requestId: checkoutRequest }),
    log('checkout.committed'),
    log('http.completed', 'ordering', {
      route: '/api/v1/checkouts',
      requestId: checkoutRequest,
      status: 201,
    }),
  ];
  const hops = journeyHops(journeys(logs)[0]!);
  expect(hops.find((x) => x.id === 'request')?.observation?.requestId).toBe(checkoutRequest);
  expect(hops.find((x) => x.id === 'response')?.observation?.requestId).toBe(checkoutRequest);
});
