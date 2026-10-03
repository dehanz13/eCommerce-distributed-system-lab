import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { server } from '@lab/runtime';
import { validateReply } from '@lab/contracts';
import { registerInspectionRoutes } from '../apps/operator/src/inspection-routes';
const app = await server('operator-inspection-test');
registerInspectionRoutes(app);
afterEach(() => vi.unstubAllGlobals());
afterAll(() => app.close());

it('serves the actual recovery page and documents its HTML content type', async () => {
  const result = await app.inject('/');
  expect(result.statusCode).toBe(200);
  expect(result.headers['content-type']).toContain('text/html');
  expect(result.body).toContain('<!doctype html>');
  expect(result.body).toContain('Lab control centre');
  const spec = app.swagger();
  const content = spec.paths?.['/']?.get?.responses?.['200'];
  expect(content).toHaveProperty('content.text/html.schema.type', 'string');
});

it('serializes the collected report and validates it through the browser contract', async () => {
  const correlationId = randomUUID(),
    time = new Date().toISOString();
  const record = {
    id: randomUUID(),
    owner: 'ordering',
    type: 'checkout.committed',
    occurredAt: time,
    correlationId,
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [record],
            meta: { requestId: randomUUID(), correlationId, respondedAt: time },
          }),
        ),
      )
      .mockRejectedValueOnce(new Error('fixture unavailable')),
  );
  const result = await app.inject('/api/v1/activity?correlationId=' + correlationId);
  expect(result.statusCode).toBe(200);
  const payload = result.json();
  expect(() => validateReply('/operator/api/v1/activity', 'GET', payload)).not.toThrow();
  expect(payload.data).toMatchObject({ exhaustive: false, limitPerOwner: 200, retentionDays: 7 });
  expect(payload.data.records).toContainEqual(record);
  expect(payload.data.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        owner: 'ordering',
        available: true,
        records: [record],
        error: null,
      }),
      expect.objectContaining({
        owner: 'fulfillment',
        available: false,
        records: [],
        error: expect.any(String),
      }),
    ]),
  );
  expect(() => validateReply('/api/v1/activity', 'GET', { ...payload, data: [] })).toThrow();
  expect(() =>
    validateReply('/api/v1/activity', 'GET', {
      ...payload,
      data: { ...payload.data, sources: [{ owner: 'ordering', available: 'yes' }] },
    }),
  ).toThrow();
});
