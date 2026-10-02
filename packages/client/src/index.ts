import { validateReply, type Reply } from '@lab/contracts';
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
export async function request<T>(
  path: string,
  options: RequestInit = {},
  base = '',
): Promise<Reply<T>> {
  const method = options.method ?? 'GET';
  let attempts = method === 'GET' ? 2 : 1;
  const start = performance.now();
  while (attempts-- > 0) {
    browserMetrics.requests++;
    try {
      const result = await fetch(base + path, {
        ...options,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
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
          browserMetrics.retries++;
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        throw e;
      }
      browserMetrics.lastDurationMs = performance.now() - start;
      validateReply(path, method, body);
      return body as Reply<T>;
    } catch (e) {
      if (e instanceof ApiError || options.signal?.aborted) {
        browserMetrics.failures++;
        throw e;
      }
      if (method === 'GET' && attempts > 0) {
        browserMetrics.retries++;
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
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
