import { it, expect, vi, afterEach } from 'vitest';
import { request, ApiError, browserActivity } from '@lab/client';
afterEach(() => vi.unstubAllGlobals());
it('sends requests and records valid identifiers on local HTTP without randomUUID', async () => {
  const originalCrypto = globalThis.crypto;
  vi.stubGlobal('crypto', { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) });
  browserActivity.length = 0;
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {},
        meta: {
          requestId: '00000000-0000-4000-8000-000000000003',
          correlationId: '00000000-0000-4000-8000-000000000003',
          respondedAt: new Date().toISOString(),
        },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  await request('/api/v1/observations', { method: 'POST' });
  const headers = (fetch.mock.calls[0]?.[1] as RequestInit).headers as Headers;
  expect(headers.get('x-correlation-id')).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(browserActivity).toHaveLength(3);
  expect(new Set(browserActivity.map((entry) => entry.id)).size).toBe(3);
});
it('retries one transient read but never repeats checkout', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'DEPENDENCY_UNAVAILABLE', detail: 'offline' }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [],
          meta: {
            requestId: '00000000-0000-4000-8000-000000000001',
            correlationId: '00000000-0000-4000-8000-000000000001',
            respondedAt: new Date().toISOString(),
          },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  await request('/products');
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockReset().mockRejectedValue(new TypeError('connection lost'));
  await expect(request('/checkouts', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not retry client validation errors', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code: 'VALIDATION_FAILED', detail: 'invalid' }), {
      status: 400,
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(request('/products')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('bounds transport retries and respects an explicitly aborted read', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
  vi.stubGlobal('fetch', fetch);
  await expect(request('/products')).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(request('/products', { signal: controller.signal })).rejects.toThrow('offline');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('correlates browser input, transport and output while redacting fictional sensitive fields', async () => {
  browserActivity.length = 0;
  const id = '00000000-0000-4000-8000-000000000003';
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: { name: 'fixture', password: 'hidden' },
        meta: { requestId: id, correlationId: id, respondedAt: new Date().toISOString() },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  await request('/api/v1/observations', {
    method: 'POST',
    headers: { 'x-correlation-id': id },
    body: JSON.stringify({ name: 'fixture', password: 'hidden' }),
  });
  expect(browserActivity.map((x) => x.stage)).toEqual(['input', 'process', 'output']);
  expect(browserActivity.every((x) => x.correlationId === id)).toBe(true);
  expect(JSON.stringify(browserActivity)).not.toContain('hidden');
  expect((fetch.mock.calls[0]?.[1] as RequestInit).headers).toBeInstanceOf(Headers);
});
