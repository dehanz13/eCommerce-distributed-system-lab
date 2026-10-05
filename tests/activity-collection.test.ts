import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { collectActivity } from '../tools/activity-collection';
import { cfg } from '@lab/runtime';
afterEach(() => vi.unstubAllGlobals());
it('collects valid source data and labels unavailable owners rather than inventing an empty healthy stream', async () => {
  const correlationId = randomUUID(),
    time = new Date().toISOString();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: randomUUID(),
              owner: 'ordering',
              type: 'checkout.committed',
              occurredAt: time,
              correlationId,
            },
          ],
          meta: { requestId: randomUUID(), correlationId, respondedAt: time },
        }),
      ),
    )
    .mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch', fetch);
  const report = await collectActivity(correlationId);
  expect(report.exhaustive).toBe(false);
  expect(report.sources.find((x) => x.owner === 'fulfillment')).toMatchObject({
    available: false,
    records: [],
    error: expect.any(String),
  });
  expect(report.records).toEqual([
    expect.objectContaining({ type: 'checkout.committed', correlationId }),
  ]);
  expect(fetch.mock.calls[0]?.[0]).toContain('?correlationId=' + correlationId);
});
it('rejects an invalid activity reply at the real runtime contract boundary', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{}] }))));
  const report = await collectActivity();
  expect(report.sources.filter((x) => x.owner !== 'operator').every((x) => !x.available)).toBe(
    true,
  );
});

it.each([200, 201])(
  'enforces the advertised owner window with %i remote records',
  async (count) => {
    const time = new Date().toISOString();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify({
              data: Array.from({ length: count }, () => ({
                id: randomUUID(),
                owner: url.startsWith(cfg.ORDERING_URL) ? 'ordering' : 'fulfillment',
                type: 'http.received',
                occurredAt: time,
              })),
              meta: { requestId: randomUUID(), correlationId: randomUUID(), respondedAt: time },
            }),
          ),
      ),
    );
    const report = await collectActivity();
    const remote = report.sources.filter((source) => source.owner !== 'operator');
    expect(remote.every((source) => source.available)).toBe(count === 200);
    expect(remote.map((source) => source.records.length)).toEqual(
      count === 200 ? [200, 200] : [0, 0],
    );
    if (count === 201) expect(remote.every((source) => source.error !== null)).toBe(true);
  },
);
