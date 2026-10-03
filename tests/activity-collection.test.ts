import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { collectActivity } from '../tools/activity-collection';
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
