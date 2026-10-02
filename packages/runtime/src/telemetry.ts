import * as metrics from '@prometheus-io/client';
const sources = new Map<string, ReturnType<typeof create>>();
function create() {
  const registry = new metrics.Registry();
  metrics.collectDefaultMetrics({ register: registry });
  const registers = [registry];
  return {
    registry,
    operations: new metrics.Counter({
      name: 'lab_business_operations_total',
      help: 'Committed business outcomes or rejected submissions',
      labelNames: ['operation', 'outcome'],
      registers,
    }),
    stock: new metrics.Counter({
      name: 'lab_stock_units_total',
      help: 'Stock units reserved, released or manually adjusted',
      labelNames: ['reason', 'direction'],
      registers,
    }),
    publication: new metrics.Counter({
      name: 'lab_event_publication_total',
      help: 'Broker publication confirmations and failed attempts',
      labelNames: ['outcome'],
      registers,
    }),
    consumption: new metrics.Counter({
      name: 'lab_event_consumption_total',
      help: 'Consumer commit, duplicate, quarantine and deferred outcomes',
      labelNames: ['outcome'],
      registers,
    }),
    attempts: new metrics.Counter({
      name: 'lab_fulfillment_attempts_total',
      help: 'Started and finished processing attempts',
      labelNames: ['outcome'],
      registers,
    }),
    duration: new metrics.Histogram({
      name: 'lab_work_duration_seconds',
      help: 'Recorded processing attempt duration',
      labelNames: ['kind'],
      buckets: [0.1, 0.5, 1, 5, 10, 30],
      registers,
    }),
    pending: new metrics.Gauge({
      name: 'lab_outbox_pending',
      help: 'Pending events at the most recent successful database sample',
      registers,
    }),
    oldest: new metrics.Gauge({
      name: 'lab_outbox_oldest_pending_seconds',
      help: 'Age of the oldest unpublished event at sampling time',
      registers,
    }),
    sampled: new metrics.Gauge({
      name: 'lab_outbox_sample_timestamp_seconds',
      help: 'Last successful outbox sample; stale when its database is unavailable',
      registers,
    }),
  };
}
// Source identity belongs to the response envelope, never an ID-valued metric label.
export function telemetry(owner: string) {
  let source = sources.get(owner);
  if (!source) {
    source = create();
    sources.set(owner, source);
  }
  return source;
}
