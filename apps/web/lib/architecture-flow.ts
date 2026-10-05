import type { ActivityRecord } from '@lab/contracts';

export type Observation = { data?: unknown; error?: string; at?: string };
export type Observations = Record<string, Observation>;
export type PieceId =
  | 'web'
  | 'ordering'
  | 'ordering-db'
  | 'rabbitmq'
  | 'fulfillment'
  | 'fulfillment-db'
  | 'operator'
  | 'redis';
export type Health = 'ready' | 'degraded' | 'unavailable' | 'stale' | 'unknown' | 'paused';
export const pieces: Array<{
  id: PieceId;
  name: string;
  stack: string;
  role: string;
  guarantee: string;
  x: number;
  y: number;
}> = [
  {
    id: 'web',
    name: 'Shop & dashboard',
    stack: 'Next.js · React · Tailwind · shadcn/ui',
    role: 'Sends JSON requests and presents owner responses.',
    guarantee: 'Saves unresolved checkout submissions. No automatic checkout retry.',
    x: 24,
    y: 26,
  },
  {
    id: 'ordering',
    name: 'Ordering',
    stack: 'Node 24 · Fastify · TypeBox · Ajv',
    role: 'Owns catalog, carts, checkout and order outcomes.',
    guarantee: 'Reserves stock, writes snapshots and stages an event in one transaction.',
    x: 260,
    y: 26,
  },
  {
    id: 'rabbitmq',
    name: 'RabbitMQ',
    stack: 'AMQP · amqplib · durable queues',
    role: 'Transports accepted and outcome event envelopes.',
    guarantee: 'Persistent messages and confirmed publication. Delivery may repeat.',
    x: 496,
    y: 26,
  },
  {
    id: 'fulfillment',
    name: 'Fulfillment',
    stack: 'Node 24 · Fastify · durable job loop',
    role: 'Records jobs, runs simulated attempts and stages outcomes.',
    guarantee: 'Three processing attempts; outages preserve pending work.',
    x: 732,
    y: 26,
  },
  {
    id: 'operator',
    name: 'Operator & terminal',
    stack: 'Fastify · clack · Docker Compose · SSH',
    role: 'Runs named lifecycle actions and observes the lab.',
    guarantee: 'Serial actions with timestamps. Unexpected crashes need manual restart.',
    x: 24,
    y: 254,
  },
  {
    id: 'ordering-db',
    name: 'Ordering database',
    stack: 'PostgreSQL · pg · SQL migrations',
    role: 'Products, carts, orders, idempotency, outbox and inbox.',
    guarantee: 'Private to ordering. Stock cannot become negative.',
    x: 260,
    y: 254,
  },
  {
    id: 'fulfillment-db',
    name: 'Fulfillment database',
    stack: 'PostgreSQL · pg · SQL migrations',
    role: 'Jobs, attempts, settings, outbox and inbox.',
    guarantee: 'Private to fulfillment. One active attempt at a time.',
    x: 732,
    y: 254,
  },
];
pieces.push({
  id: 'redis',
  name: 'Catalog cache',
  stack: 'Redis · 15 s TTL · cache-aside',
  role: 'Caches revisioned catalog JSON. PostgreSQL remains authoritative.',
  guarantee: 'Cache failure falls back to SQL. Checkout and preview bypass Redis.',
  x: 496,
  y: 254,
});
export const connections = [
  {
    id: 'cache',
    from: 'ordering',
    to: 'redis',
    path: 'M430 172 V214 H596 V254',
    label: 'Catalog lookup / fill',
  },

  { id: 'request', from: 'web', to: 'ordering', path: 'M224 64 H260', label: 'REST request' },
  { id: 'response', from: 'ordering', to: 'web', path: 'M260 112 H224', label: 'JSON response' },
  {
    id: 'ordering-write',
    from: 'ordering',
    to: 'ordering-db',
    path: 'M360 172 V254',
    label: 'SQL transaction',
  },
  {
    id: 'accepted',
    from: 'ordering',
    to: 'rabbitmq',
    path: 'M460 64 H496',
    label: 'order.accepted',
  },
  {
    id: 'delivery',
    from: 'rabbitmq',
    to: 'fulfillment',
    path: 'M696 64 H732',
    label: 'Consume + acknowledge',
  },
  {
    id: 'fulfillment-write',
    from: 'fulfillment',
    to: 'fulfillment-db',
    path: 'M832 172 V254',
    label: 'SQL transaction',
  },
  {
    id: 'outcome',
    from: 'fulfillment',
    to: 'rabbitmq',
    path: 'M732 112 H696',
    label: 'fulfillment outcome',
  },
  {
    id: 'outcome-delivery',
    from: 'rabbitmq',
    to: 'ordering',
    path: 'M496 112 H460',
    label: 'Outcome + compensation',
  },
  { id: 'control', from: 'web', to: 'operator', path: 'M124 172 V254', label: 'Named controls' },
] as const;
export const nextPieces = [
  {
    name: 'Customer data enricher',
    stack: 'TypeScript · Fastify · RabbitMQ',
    why: 'Validate and enrich fictional records; introduce versioned input/output events.',
  },
  {
    name: 'Batch & file processor',
    stack: 'TypeScript · local SFTP container · scheduled loop',
    why: 'Receive a file, validate rows, checkpoint processing and quarantine bad input.',
  },
];
/** Accept only an object-shaped observation.
 * Input: value, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Extract object records from an observation array.
 * Input: value, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((x) => x !== null && typeof x === 'object' && !Array.isArray(x))
    : [];
}
// Last-known data remains inspectable, but cannot establish present health.
/** Classify an observation by sample age, errors and refresh state.
 * Input: sample, now, polling, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function isStale(sample: Observation | undefined, now: number, polling: boolean) {
  return (
    !polling ||
    !sample?.at ||
    now - Date.parse(sample.at) > 10000 ||
    !Number.isFinite(Date.parse(sample.at))
  );
}
/** Interpret sampled owner/dependency health without inventing availability.
 * Input: id, samples, now, polling, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function pieceHealth(
  id: PieceId,
  samples: Observations,
  now: number,
  polling: boolean,
): Health {
  if (id === 'redis') {
    if (samples.cache?.error || isStale(samples.cache, now, polling))
      return samples.cache?.at ? 'stale' : 'unknown';
    return object(samples.cache?.data).connected === true ? 'ready' : 'unavailable';
  }
  const sample = samples.status;
  if (sample?.error) return 'stale';
  if (isStale(sample, now, polling)) return sample?.at ? 'stale' : 'unknown';
  const services = records(object(sample?.data).services);
  const owner = services.find(
    (x) =>
      x.name === (id === 'ordering-db' ? 'ordering' : id === 'fulfillment-db' ? 'fulfillment' : id),
  );
  if (id === 'rabbitmq') {
    const peers = services.filter(
      (x) => ['ordering', 'fulfillment'].includes(String(x.name)) && x.reachable,
    );
    if (peers.some((x) => x.broker === true))
      return peers.some((x) => x.broker === false) ? 'degraded' : 'ready';
    if (peers.some((x) => x.broker === false)) return 'unavailable';
    return 'unknown';
  }
  if (!owner || owner.reachable !== true) return id.endsWith('-db') ? 'unknown' : 'unavailable';
  if (id.endsWith('-db'))
    return owner.database === true ? 'ready' : owner.database === false ? 'unavailable' : 'unknown';
  if (owner.ready !== true) return 'degraded';
  if (
    id === 'fulfillment' &&
    !isStale(samples.fulfillment, now, polling) &&
    !samples.fulfillment?.error &&
    object(object(samples.fulfillment?.data).settings).paused === true
  )
    return 'paused';
  return 'ready';
}
const diagnosticRoutes = /^\/api\/v1\/(system|status|host|broker|actions)$/;
/** Collect and deduplicate retained owner observations.
 * Input: samples, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function observedActivity(samples: Observations): ActivityRecord[] {
  const unique = new Map<string, ActivityRecord>();
  for (const key of ['orderingLogs', 'fulfillmentLogs', 'operatorLogs']) {
    for (const row of records(samples[key]?.data)) {
      if (
        typeof row.id !== 'string' ||
        typeof row.type !== 'string' ||
        typeof row.owner !== 'string' ||
        typeof row.occurredAt !== 'string'
      )
        continue;
      if (row.method === 'GET' && diagnosticRoutes.test(String(row.route))) continue;
      unique.set(row.id, row as ActivityRecord);
    }
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}
export type Journey = {
  id: string;
  submissionReference?: string;
  correlationIds: string[];
  checkout: boolean;
  label: string;
  logs: ActivityRecord[];
  lastAt: string;
};
/** Group recorded activity by scoped submission identity and unambiguous correlations.
 * Input: activity, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function journeys(activity: ActivityRecord[]): Journey[] {
  const references = new Map<string, Set<string>>();
  for (const item of activity) {
    if (!item.correlationId || !item.submissionReference) continue;
    const found = references.get(item.correlationId) ?? new Set<string>();
    found.add(item.submissionReference);
    references.set(item.correlationId, found);
  }
  const groups = new Map<string, ActivityRecord[]>();
  for (const item of activity) {
    if (!item.correlationId) continue;
    const candidates = references.get(item.correlationId);
    const reference =
      item.submissionReference ?? (candidates?.size === 1 ? [...candidates][0] : undefined);
    const key = reference ? 'submission:' + reference : 'correlation:' + item.correlationId;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups]
    .map(([, grouped]) => {
      const logs = [...grouped].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
      const correlationIds = [
        ...new Set(logs.flatMap((x) => (x.correlationId ? [x.correlationId] : []))),
      ];
      const submissionReference = logs.find((x) => x.submissionReference)?.submissionReference;
      const id = submissionReference ?? correlationIds[0]!;
      const checkout = logs.some(
        (x) =>
          x.type.startsWith('checkout.') ||
          x.route === '/api/v1/checkouts' ||
          x.type === 'job.recorded' ||
          x.type === 'outcome.applied',
      );
      const request =
        logs.find((x) => x.type === 'http.received') ??
        logs.find((x) => x.type === 'http.completed');
      return {
        id,
        correlationIds,
        submissionReference,
        checkout,
        logs,
        label: checkout
          ? 'Checkout'
          : `${request?.method ?? 'Event'} ${request?.route ?? logs[0]?.type ?? ''}`,
        lastAt: logs.at(-1)!.occurredAt,
      };
    })
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}
export type Hop = {
  id: string;
  label: string;
  description: string;
  edge: string;
  observation?: ActivityRecord;
};
/** Only explicit observations establish a milestone. Missing logs never imply failure or success.
 * Input: journey, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function journeyHops(journey: Journey): Hop[] {
  /** Find the first observed milestone matching the local predicate.
   * Input: predicate, from the selected journey’s retained observations.
   * Communicates with local computation/presentation only; no direct network or database calls.
   */
  const find = (predicate: (item: ActivityRecord) => boolean) => journey.logs.find(predicate);
  const received = find(
    (x) => x.type === 'http.received' && (!journey.checkout || x.route === '/api/v1/checkouts'),
  );
  const response = find(
    (x) =>
      x.type === 'http.completed' &&
      (!journey.checkout || x.route === '/api/v1/checkouts') &&
      (!received?.requestId || x.requestId === received.requestId),
  );
  const basic: Hop[] = [
    {
      id: 'request',
      label: 'Request received',
      description:
        'The owner observed a request; this does not prove the browser received a reply.',
      edge: received?.owner === 'operator' ? 'control' : 'request',
      observation: received,
    },
    {
      id: 'response',
      label: 'Server response finished',
      description:
        'The server completed its response. A lost browser response still requires explicit recovery.',
      edge: 'response',
      observation: response,
    },
  ];
  // A rejected checkout has an HTTP outcome but no accepted-order journey.
  if (!journey.checkout && journey.logs.some((x) => x.type.startsWith('cache.'))) {
    const observed = journey.logs
      .filter((x) => x.type.startsWith('cache.'))
      .map((x) => ({
        id: x.id,
        label: x.type.replace('cache.', 'Cache: '),
        description: String(x.key ?? '') + ' · observation from ordering',
        edge: x.type === 'cache.database' ? 'ordering-write' : 'cache',
        observation: x,
      }));
    return [basic[0]!, ...observed, basic[1]!];
  }
  if (
    !journey.checkout ||
    (response &&
      Number(response.status) >= 400 &&
      !find((x) => x.type === 'checkout.committed' || x.type === 'checkout.recovered'))
  )
    return basic;
  return [
    basic[0]!,
    {
      id: 'commit',
      label: 'Checkout committed',
      description:
        'Stock, order snapshots, cart revision, idempotency result and outbox committed together.',
      edge: 'ordering-write',
      observation: find((x) => ['checkout.committed', 'checkout.recovered'].includes(x.type)),
    },
    basic[1]!,
    {
      id: 'accepted',
      label: 'Accepted event confirmed',
      description:
        'RabbitMQ confirmed publication of order.accepted; repeated delivery remains possible.',
      edge: 'accepted',
      observation: find((x) => x.type === 'event.published' && x.eventType === 'order.accepted'),
    },
    {
      id: 'delivery',
      label: 'Fulfillment received event',
      description:
        'The consumer validated the envelope before attempting its database transaction.',
      edge: 'delivery',
      observation: find((x) => x.type === 'event.received' && x.owner === 'fulfillment'),
    },
    {
      id: 'job',
      label: 'Job recorded',
      description: 'The inbox and job committed before consumer acknowledgment.',
      edge: 'fulfillment-write',
      observation: find((x) => x.type === 'job.recorded'),
    },
    {
      id: 'attempt',
      label: 'Attempt started',
      description: 'An attempt and deadline were persisted; a restart can resume the same attempt.',
      edge: 'fulfillment-write',
      observation: find((x) => x.type === 'attempt.started'),
    },
    {
      id: 'processed',
      label: 'Terminal processing recorded',
      description:
        'The final attempt and outcome event committed together. Intermediate retries remain in the timeline.',
      edge: 'fulfillment-write',
      observation: find(
        (x) => x.type === 'attempt.finished' && ['complete', 'fail'].includes(String(x.outcome)),
      ),
    },
    {
      id: 'outcome',
      label: 'Outcome event confirmed',
      description: 'RabbitMQ confirmed fulfillment.completed or fulfillment.failed.',
      edge: 'outcome',
      observation: find(
        (x) => x.type === 'event.published' && !!x.eventType?.startsWith('fulfillment.'),
      ),
    },
    {
      id: 'outcome-delivery',
      label: 'Ordering received outcome',
      description: 'Ordering validated the event before applying its effects.',
      edge: 'outcome-delivery',
      observation: find((x) => x.type === 'event.received' && x.owner === 'ordering'),
    },
    {
      id: 'terminal',
      label: 'Order outcome committed',
      description: 'Ordering committed the terminal state. A failure releases stock once.',
      edge: 'ordering-write',
      observation: find((x) => x.type === 'outcome.applied'),
    },
  ];
}
/** Describe an observed business or HTTP outcome without inferring missing completion.
 * Input: journey, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function journeyOutcome(journey: Journey) {
  const terminal = journey.logs.find((x) => x.type === 'outcome.applied');
  if (terminal)
    return terminal.eventType === 'fulfillment.failed' ? 'failed · stock released' : 'fulfilled';
  const response = journey.logs.find((x) => x.type === 'http.completed' && Number(x.status) >= 400);
  if (
    response &&
    !journey.logs.some((x) => ['checkout.committed', 'checkout.recovered'].includes(x.type))
  )
    return `HTTP ${response.status} · request rejected`;
  return journey.checkout ? 'Awaiting observed outcome' : 'HTTP activity';
}
/** Map one observed operation to its diagram connection.
 * Input: item, from polled owner/operator observations supplied by the dashboard.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function activityEdge(item: ActivityRecord) {
  if (item.type.startsWith('cache.'))
    return item.type === 'cache.database' ? 'ordering-write' : 'cache';
  if (item.type === 'http.received')
    return item.owner === 'operator'
      ? 'control'
      : item.owner === 'ordering'
        ? 'request'
        : undefined;
  if (item.type === 'http.completed') return item.owner === 'ordering' ? 'response' : undefined;
  if (item.type.startsWith('checkout.') || item.type.startsWith('outcome.'))
    return 'ordering-write';
  if (item.type.startsWith('attempt.') || item.type.startsWith('job.')) return 'fulfillment-write';
  if (item.type === 'event.published') return item.owner === 'ordering' ? 'accepted' : 'outcome';
  if (item.type === 'event.received' || item.type === 'event.acknowledged')
    return item.owner === 'fulfillment' ? 'delivery' : 'outcome-delivery';
  return undefined;
}
