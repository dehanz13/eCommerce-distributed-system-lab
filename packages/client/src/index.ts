import { safeObservation, validateReply, type Reply } from '@lab/contracts';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}
export const browserMetrics = { requests: 0, retries: 0, failures: 0, lastDurationMs: 0 };
export const browserActivity: Record<string, unknown>[] = [];
function observationId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Local HTTP hostnames may lack randomUUID; getRandomValues remains available.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function observe(data: Record<string, unknown>) {
  browserActivity.push({
    ...(safeObservation(data) as object),
    id: observationId(),
    owner: 'web',
    occurredAt: new Date().toISOString(),
  });
  if (browserActivity.length > 200) browserActivity.shift();
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
  base = '',
): Promise<Reply<T>> {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  const correlationId = headers.get('x-correlation-id') ?? observationId();
  headers.set('x-correlation-id', correlationId);
  if (options.body) headers.set('Content-Type', 'application/json');
  const traced =
    !(method === 'GET' && headers.get('x-lab-observation') === 'poll') &&
    (/^\/api\/v1\/(products|carts|checkouts|orders)(?:\/|$)/.test(path) ||
      (method !== 'GET' && path.includes('/api/v1/')));
  const log = (data: Record<string, unknown>) => {
    if (traced) observe({ correlationId, method, route: path.split('?')[0], ...data });
  };
  let input: unknown;
  if (typeof options.body === 'string') {
    try {
      input = JSON.parse(options.body);
    } catch {
      input = '[invalid JSON]';
    }
  }
  log({ type: 'http.input', stage: 'input', input });
  let attempts = method === 'GET' ? 2 : 1;
  const start = performance.now();
  while (attempts-- > 0) {
    browserMetrics.requests++;
    log({ type: 'http.sending', stage: 'process', attempt: method === 'GET' ? 2 - attempts : 1 });
    try {
      const result = await fetch(base + path, {
        ...options,
        headers,
        signal: options.signal ?? AbortSignal.timeout(8000),
      });
      const body = await result.json();
      if (!result.ok) {
        const e = new ApiError(
          result.status,
          body.code ?? 'HTTP_ERROR',
          body.detail ?? 'Request failed',
          body.details,
        );
        if (method === 'GET' && attempts > 0 && [502, 503, 504].includes(result.status)) {
          log({ type: 'http.retry', stage: 'process', status: result.status, retryDelayMs: 250 });
          browserMetrics.retries++;
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        throw e;
      }
      browserMetrics.lastDurationMs = performance.now() - start;
      validateReply(path, method, body);
      log({
        type: 'http.completed',
        stage: 'output',
        ...body.meta,
        status: result.status,
        output: body,
        durationMs: browserMetrics.lastDurationMs,
      });
      return body as Reply<T>;
    } catch (e) {
      if (e instanceof ApiError || options.signal?.aborted) {
        log({
          type: 'http.failed',
          stage: 'output',
          status: e instanceof ApiError ? e.status : 0,
          code: e instanceof ApiError ? e.code : 'CANCELLED',
          durationMs: performance.now() - start,
        });
        browserMetrics.failures++;
        throw e;
      }
      if (method === 'GET' && attempts > 0) {
        log({
          type: 'http.retry',
          stage: 'process',
          retryDelayMs: 250,
          outcome: 'transport_failure',
        });
        browserMetrics.retries++;
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      log({
        type: 'http.failed',
        stage: 'output',
        status: 0,
        code: 'OUTCOME_UNKNOWN',
        durationMs: performance.now() - start,
      });
      browserMetrics.failures++;
      throw new ApiError(
        0,
        'OUTCOME_UNKNOWN',
        'Connection lost or timed out; the outcome may be unknown.',
      );
    }
  }
  throw new Error('UNREACHABLE');
}
