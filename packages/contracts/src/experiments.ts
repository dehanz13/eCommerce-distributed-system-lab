import { Type, type Static } from '@sinclair/typebox';
export const FeederInput = Type.Object(
  {
    shoppers: Type.Integer({ minimum: 1, maximum: 500 }),
    concurrency: Type.Integer({ minimum: 1, maximum: 20 }),
    seed: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    thinkMs: Type.Integer({ minimum: 0, maximum: 2000 }),
  },
  { additionalProperties: false },
);
export type FeederOptions = Static<typeof FeederInput>;
export const faultNames = [
  'cache-outage',
  'broker-outage',
  'database-outage',
  'fulfillment-restart',
  'network-latency',
  'network-cut',
  'slow-processing',
  'retry-processing',
  'failed-processing',
] as const;
export const ExperimentInput = Type.Object(
  {
    scenario: Type.Union(faultNames.map((x) => Type.Literal(x))),
    durationSeconds: Type.Integer({ minimum: 3, maximum: 30 }),
  },
  { additionalProperties: false },
);
export type ExperimentOptions = Static<typeof ExperimentInput>;
export interface FeederRun {
  id: string;
  options: FeederOptions;
  status: 'running' | 'stopping' | 'completed' | 'stopped' | 'interrupted';
  requestedAt: string;
  finishedAt: string | null;
  started: number;
  finished: number;
  active: number;
  accepted: number;
  abandoned: number;
  rejected: number;
  unknown: number;
  requestCount: number;
  requestErrors: number;
  totalRequestMs: number;
  outcomes: Array<{
    shopperId: string;
    correlationId: string;
    outcome: string;
    orderId?: string;
    code?: string;
  }>;
  unresolved: Array<{
    shopperId: string;
    correlationId: string;
    key: string;
    body: { cartId: string; revision: number; priceFingerprint: string };
  }>;
  error?: string;
}
export interface ExperimentRun {
  id: string;
  options: ExperimentOptions;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  requestedAt: string;
  finishedAt: string | null;
  expected: string;
  progress: string;
  before?: unknown;
  during?: unknown;
  after?: unknown;
  error?: string;
  restoration: 'pending' | 'completed' | 'failed' | 'unknown';
}

const uuid = Type.String({ format: 'uuid' });
const timestamp = Type.String({ format: 'date-time' });
const count = Type.Integer({ minimum: 0 });
export const FeederRunSchema = Type.Object({
  id: uuid,
  options: FeederInput,
  status: Type.Union(
    ['running', 'stopping', 'completed', 'stopped', 'interrupted'].map((x) => Type.Literal(x)),
  ),
  requestedAt: timestamp,
  finishedAt: Type.Union([timestamp, Type.Null()]),
  started: count,
  finished: count,
  active: count,
  accepted: count,
  abandoned: count,
  rejected: count,
  unknown: count,
  requestCount: count,
  requestErrors: count,
  totalRequestMs: Type.Number({ minimum: 0 }),
  outcomes: Type.Array(
    Type.Object({
      shopperId: uuid,
      correlationId: uuid,
      outcome: Type.String(),
      orderId: Type.Optional(uuid),
      code: Type.Optional(Type.String()),
    }),
  ),
  unresolved: Type.Array(
    Type.Object({
      shopperId: uuid,
      correlationId: uuid,
      key: uuid,
      body: Type.Object({
        cartId: uuid,
        revision: count,
        priceFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      }),
    }),
  ),
  error: Type.Optional(Type.String()),
});
export const ExperimentRunSchema = Type.Object({
  id: uuid,
  options: ExperimentInput,
  status: Type.Union(['running', 'completed', 'failed', 'interrupted'].map((x) => Type.Literal(x))),
  requestedAt: timestamp,
  finishedAt: Type.Union([timestamp, Type.Null()]),
  expected: Type.String(),
  progress: Type.String(),
  before: Type.Optional(Type.Unknown()),
  during: Type.Optional(Type.Unknown()),
  after: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
  restoration: Type.Union(
    ['pending', 'completed', 'failed', 'unknown'].map((x) => Type.Literal(x)),
  ),
});
export const CacheSchema = Type.Object({
  strategy: Type.String(),
  ttlSeconds: count,
  lastKey: Type.Union([Type.String(), Type.Null()]),
  counts: Type.Record(Type.String(), count),
  activeFills: count,
  connected: Type.Boolean(),
  sampledAt: timestamp,
});
