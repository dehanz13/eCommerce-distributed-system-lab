import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot, loadConfiguration } from './configuration';
export { projectRoot } from './configuration';
import pg from 'pg';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import { httpSchema } from '@lab/contracts';
import * as metrics from '@prometheus-io/client';
import { telemetry } from './telemetry';
export const root = projectRoot();
export const cfg = loadConfiguration();
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
  try {
    await c.query('BEGIN');
    const result = await run(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
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
const logDir = path.join(root, '.lab/logs');
export function activity(owner: string, type: string, data: Record<string, unknown> = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, `${owner}-${new Date().toISOString().slice(0, 10)}.ndjson`);
  fs.appendFileSync(
    file,
    JSON.stringify({
      id: randomUUID(),
      owner,
      type,
      occurredAt: new Date().toISOString(),
      ...data,
    }) + '\n',
  );
  pruneLogs();
}
export function pruneLogs() {
  if (!fs.existsSync(logDir)) return;
  const files = fs
    .readdirSync(logDir)
    .map((n) => ({ p: path.join(logDir, n), s: fs.statSync(path.join(logDir, n)) }))
    .sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
  let size = files.reduce((s, f) => s + f.s.size, 0);
  for (const f of files)
    if (Date.now() - f.s.mtimeMs > 7 * 86400000 || size > 100 * 1024 * 1024) {
      fs.rmSync(f.p, { force: true });
      size -= f.s.size;
    }
}
export function readActivity(owner: string, correlationId?: string) {
  if (!fs.existsSync(logDir)) return [];
  const files = fs
    .readdirSync(logDir)
    .filter((f) => f.startsWith(owner + '-'))
    .sort()
    .slice(-2);
  return files
    .flatMap((f) => {
      const p = path.join(logDir, f);
      const s = fs.statSync(p);
      const fd = fs.openSync(p, 'r');
      try {
        const start = Math.max(0, s.size - 512 * 1024);
        const b = Buffer.alloc(s.size - start);
        fs.readSync(fd, b, 0, b.length, start);
        const lines = b.toString().split('\n');
        if (start > 0) lines.shift();
        return lines.filter(Boolean).flatMap((l) => {
          try {
            return [JSON.parse(l) as Record<string, unknown>];
          } catch {
            return [];
          }
        });
      } finally {
        fs.closeSync(fd);
      }
    })
    .filter((x) => !correlationId || x.correlationId === correlationId)
    .slice(-200)
    .reverse();
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
    if (options.url === '/openapi.json') return;
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
  const traced = (route: string) =>
    /^\/api\/v1\/(products|carts|checkouts|orders|jobs|settings|actions)(?:\/|$)/.test(route);
  app.addHook('onRequest', async (req) => {
    times.set(req, performance.now());
    const route = req.routeOptions.url ?? 'unmatched';
    if (traced(route))
      activity(owner, 'http.received', {
        ...identifiers(req),
        method: req.method,
        route,
      });
  });
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    count.inc({ route, status: String(reply.statusCode) });
    durations.observe(
      { route },
      (performance.now() - (times.get(req) ?? performance.now())) / 1000,
    );
    if (traced(route))
      activity(owner, 'http.completed', {
        ...identifiers(req),
        method: req.method,
        route,
        status: reply.statusCode,
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
    if (!(e instanceof Problem) && !e.validation)
      activity(owner, 'operation.failed', { ...identifiers(req), message: e.message });
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
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    task()
      .catch((e) => activity(owner, 'dependency.waiting', { message: String(e) }))
      .finally(() => {
        busy = false;
      });
  }, ms);
  return () => clearInterval(t);
}
