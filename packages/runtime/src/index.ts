import { randomUUID } from 'node:crypto';
import { projectRoot, loadConfiguration } from './configuration';
export { projectRoot } from './configuration';
import pg from 'pg';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import { httpSchema } from '@lab/contracts';
import * as metrics from '@prometheus-io/client';
import { telemetry } from './telemetry';
import { activity, readActivity, trace, safeObservation, redactValues } from './observation';
export { activity, readActivity, pruneLogs, trace } from './observation';
export const root = projectRoot();
export const cfg = loadConfiguration();
redactValues(
  Object.entries(cfg)
    .filter(([key]) => /PASSWORD|SECRET|TOKEN/.test(key))
    .map(([, value]) => value),
);
export function pool(owner: 'ordering' | 'fulfillment') {
  const name = owner.toUpperCase() as 'ORDERING' | 'FULFILLMENT';
  const p = new pg.Pool({
    host: cfg.PG_HOST,
    port: +cfg.PG_PORT,
    user: cfg[`${name}_USER`],
    password: cfg[`${name}_PASSWORD`],
    database: cfg[`${name}_DB`],
    max: 5,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  });
  p.on('error', (e) => activity(owner, 'database.disconnected', { message: e.message }));
  return p;
}
export async function transaction<T>(
  p: pg.Pool,
  run: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await p.connect();
  const context = trace.getStore();
  const transactionId = randomUUID();
  const original = c.query;
  let step = 0;
  if (context)
    c.query = (async (...args: unknown[]) => {
      const statement =
        typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '');
      const started = performance.now();
      const number = ++step;
      activity(context.owner, 'transaction.step', {
        transactionId,
        step: number,
        statement: statement.replace(/\s+/g, ' ').trim(),
        stage: 'process',
      });
      try {
        const result = await Reflect.apply(original, c, args);
        activity(context.owner, 'transaction.step_result', {
          transactionId,
          step: number,
          rowCount: result.rowCount,
          durationMs: performance.now() - started,
          stage: 'process',
        });
        return result;
      } catch (error) {
        activity(context.owner, 'transaction.step_failed', {
          transactionId,
          step: number,
          error,
          stage: 'process',
        });
        throw error;
      }
    }) as typeof c.query;
  try {
    await c.query('BEGIN');
    const result = await run(c);
    await c.query('COMMIT');
    if (context) activity(context.owner, 'transaction.committed', { transactionId, steps: step });
    return result;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (context)
      activity(context.owner, 'transaction.rolled_back', {
        transactionId,
        steps: step,
        stage: 'output',
        error: e,
      });
    throw e;
  } finally {
    c.query = original;
    c.release();
  }
}
export class Problem extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}
export function identifiers(req: FastifyRequest) {
  const raw = req.headers['x-correlation-id'];
  return {
    requestId: req.id,
    correlationId:
      typeof raw === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw)
        ? raw
        : req.id,
  };
}
export function response<T>(req: FastifyRequest, data: T) {
  return { data, meta: { ...identifiers(req), respondedAt: new Date().toISOString() } };
}
export async function server(owner: string) {
  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
    bodyLimit: 65536,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  await app.register(swagger, {
    openapi: { info: { title: owner + ' learning API', version: '1.0.0' } },
  });
  app.addHook('onRoute', (options) => {
    if (options.url === '/openapi.json' || options.schema?.response) return;
    const method = Array.isArray(options.method) ? options.method[0]! : options.method;
    options.schema = { ...options.schema, response: { '2xx': httpSchema(options.url, method) } };
  });
  const register = telemetry(owner).registry;
  const count = new metrics.Counter({
    name: 'lab_http_requests_total',
    help: 'Completed HTTP requests',
    labelNames: ['route', 'status'],
    registers: [register],
  });
  const durations = new metrics.Histogram({
    name: 'lab_http_duration_seconds',
    help: 'Request duration',
    labelNames: ['route'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [register],
  });
  const times = new WeakMap<object, number>();
  const traced = (route: string, method: string, polling = false) =>
    !polling &&
    (/^\/api\/v1\/(products|carts|checkouts|orders|jobs)(?:\/|$)/.test(route) ||
      (method !== 'GET' && route.startsWith('/api/v1/')));
  app.addHook('onRequest', (req, _reply, done) => {
    times.set(req, performance.now());
    const route = req.routeOptions.url ?? 'unmatched';
    if (
      traced(route, req.method, req.method === 'GET' && req.headers['x-lab-observation'] === 'poll')
    )
      activity(owner, 'http.received', {
        ...identifiers(req),
        method: req.method,
        route,
        stage: 'input',
      });
    trace.run({ owner, ...identifiers(req) }, done);
  });
  app.addHook('preValidation', async (req) => {
    const route = req.routeOptions.url ?? 'unmatched';
    if (
      traced(route, req.method, req.method === 'GET' && req.headers['x-lab-observation'] === 'poll')
    )
      activity(owner, 'http.input', {
        ...identifiers(req),
        stage: 'input',
        input: { params: req.params, query: req.query, body: req.body },
      });
  });
  app.addHook('preHandler', async (req) => {
    if (
      traced(
        req.routeOptions.url ?? '',
        req.method,
        req.method === 'GET' && req.headers['x-lab-observation'] === 'poll',
      )
    )
      activity(owner, 'http.processing', {
        ...identifiers(req),
        stage: 'process',
        step: 'validated request; invoke owner handler',
      });
  });
  const outputs = new WeakMap<object, unknown>();
  app.addHook('onSend', async (req, _reply, payload) => {
    if (
      traced(
        req.routeOptions.url ?? '',
        req.method,
        req.method === 'GET' && req.headers['x-lab-observation'] === 'poll',
      ) &&
      typeof payload === 'string'
    ) {
      try {
        outputs.set(req, safeObservation(JSON.parse(payload)));
      } catch {
        outputs.set(req, '[non-JSON response]');
      }
    }
    return payload;
  });
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    count.inc({ route, status: String(reply.statusCode) });
    durations.observe(
      { route },
      (performance.now() - (times.get(req) ?? performance.now())) / 1000,
    );
    if (
      traced(route, req.method, req.method === 'GET' && req.headers['x-lab-observation'] === 'poll')
    )
      activity(owner, 'http.completed', {
        ...identifiers(req),
        method: req.method,
        route,
        status: reply.statusCode,
        stage: 'output',
        output: outputs.get(req),
        durationMs: Math.max(0, performance.now() - (times.get(req) ?? performance.now())),
      });
  });
  app.setErrorHandler((unknownError, req, reply) => {
    const e = unknownError as Error & { validation?: unknown; statusCode?: number; code?: string };
    const p =
      e instanceof Problem
        ? e
        : e.validation
          ? new Problem(400, 'VALIDATION_FAILED', 'Check the supplied fields', e.validation)
          : e.statusCode && e.statusCode >= 400 && e.statusCode < 500
            ? new Problem(e.statusCode, 'INVALID_REQUEST', e.message)
            : new Problem(
                503,
                'DEPENDENCY_UNAVAILABLE',
                'The operation could not complete; inspect system status',
              );
    activity(owner, 'operation.failed', {
      ...identifiers(req),
      stage: 'output',
      status: p.status,
      code: p.code,
      message: p.message,
      details: p.details,
      cause: { name: e.name, code: e.code, message: e.message },
    });
    reply
      .code(p.status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: p.code,
        status: p.status,
        detail: p.message,
        code: p.code,
        details: p.details,
        ...identifiers(req),
        respondedAt: new Date().toISOString(),
      });
  });
  app.get('/metrics', async (req) =>
    response(req, {
      owner,
      processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      sampledAt: new Date().toISOString(),
      metrics: await register.getMetricsAsJSON(),
    }),
  );
  app.get('/activity', async (req) =>
    response(req, readActivity(owner, (req.query as { correlationId?: string }).correlationId)),
  );
  app.get('/openapi.json', () => app.swagger());
  return app;
}
export async function listen(app: FastifyInstance, url: string) {
  await app.listen({ host: '0.0.0.0', port: +(new URL(url).port || 80) });
}
export function loop(owner: string, task: () => Promise<void>, ms = 500) {
  let busy = false;
  let lastFailure = '';
  let lastLogged = 0;
  let suppressed = 0;
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    task()
      .then(() => {
        if (lastFailure) activity(owner, 'dependency.recovered', { suppressed });
        lastFailure = '';
        suppressed = 0;
      })
      .catch((e) => {
        const message = String(e);
        if (message !== lastFailure || Date.now() - lastLogged >= 30000) {
          activity(owner, 'dependency.waiting', { message, suppressed });
          lastLogged = Date.now();
          suppressed = 0;
        } else suppressed++;
        lastFailure = message;
      })
      .finally(() => {
        busy = false;
      });
  }, ms);
  return () => clearInterval(t);
}
