import { Type, type Static } from '@sinclair/typebox';
const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const ResourceSnapshotSchema = Type.Object({
  scope: Type.String(),
  source: Type.String(),
  sampledAt: Type.String({ format: 'date-time' }),
  available: Type.Boolean(),
  totalMemoryBytes: nullableNumber,
  freeMemoryBytes: nullableNumber,
  diskFreeBytes: nullableNumber,
  loadAverage: Type.Union([Type.Array(Type.Number()), Type.Null()]),
  managedResidentBytes: nullableNumber,
  error: Type.Union([Type.String(), Type.Null()]),
});
export type ResourceSnapshot = Static<typeof ResourceSnapshotSchema>;
export const CleanupReportSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  action: Type.String(),
  sampledAt: Type.String({ format: 'date-time' }),
  verified: Type.Boolean(),
  baselineRestored: Type.Null(),
  hosts: Type.Array(
    Type.Object({
      scope: Type.String(),
      before: Type.Union([ResourceSnapshotSchema, Type.Null()]),
      after: ResourceSnapshotSchema,
      freeMemoryDeltaBytes: nullableNumber,
    }),
  ),
  services: Type.Array(
    Type.Object({
      name: Type.String(),
      running: Type.Union([Type.Boolean(), Type.Null()]),
      error: Type.Optional(Type.String()),
    }),
  ),
  errors: Type.Array(Type.String()),
  retained: Type.Array(Type.String()),
  lessons: Type.Optional(Type.Array(Type.String())),
  recoverySteps: Type.Optional(Type.Array(Type.String())),
});
export type CleanupReport = Static<typeof CleanupReportSchema>;
const serviceName = Type.Union(
  ['web', 'ordering', 'fulfillment', 'postgres', 'rabbitmq', 'redis', 'toxiproxy'].map((x) =>
    Type.Literal(x),
  ),
);
export const ActionInput = Type.Union([
  Type.Object(
    {
      name: Type.Union(['start', 'stop', 'restart'].map((x) => Type.Literal(x))),
      service: Type.Optional(serviceName),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { name: Type.Union(['seed', 'reset', 'poweroff'].map((x) => Type.Literal(x))) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.Union(['pause', 'resume'].map((x) => Type.Literal(x))),
      service: Type.Optional(Type.Literal('fulfillment')),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.Literal('preset'),
      preset: Type.Union(['success', 'slow', 'retry', 'fail'].map((x) => Type.Literal(x))),
      service: Type.Optional(Type.Literal('fulfillment')),
    },
    { additionalProperties: false },
  ),
]);
export const ActionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  service: Type.Optional(Type.String()),
  status: Type.Union(['requested', 'running', 'completed', 'failed'].map((x) => Type.Literal(x))),
  requestedAt: Type.String({ format: 'date-time' }),
  startedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  finishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  progress: Type.String(),
  cleanup: Type.Optional(CleanupReportSchema),
});
export type OperatorAction = Static<typeof ActionSchema>;
