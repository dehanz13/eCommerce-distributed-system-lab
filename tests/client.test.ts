import { it, expect, vi, afterEach } from 'vitest';
import { request, ApiError } from '@lab/client';
afterEach(() => vi.unstubAllGlobals());
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
