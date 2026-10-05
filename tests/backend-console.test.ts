import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { server } from '@lab/runtime';
import { validateReply } from '@lab/contracts';
import { registerInspectionRoutes } from '../apps/operator/src/inspection-routes';
import { backendDiagram } from '../tools/backend-diagram';
import layout from '../tools/backend-map.json';
const app = await server('backend-console-test');
registerInspectionRoutes(app);
afterEach(() => vi.unstubAllGlobals());
afterAll(() => app.close());

it('keeps connector lanes clear of cards and other connectors', () => {
  const segments = layout.edges.flatMap((edge) =>
    edge.points.slice(1).map((point, index) => ({
      edge: edge.id,
      start: edge.points[index]!,
      end: point,
    })),
  );
  for (const segment of segments) {
    const left = Math.min(segment.start[0]!, segment.end[0]!);
    const right = Math.max(segment.start[0]!, segment.end[0]!);
    const top = Math.min(segment.start[1]!, segment.end[1]!);
    const bottom = Math.max(segment.start[1]!, segment.end[1]!);
    for (const node of layout.nodes) {
      const entersCard =
        left < node.x + layout.nodeWidth &&
        right > node.x &&
        top < node.y + layout.nodeHeight &&
        bottom > node.y;
      expect(entersCard, segment.edge + ' intersects ' + node.id).toBe(false);
    }
    for (const other of segments.filter((other) => other.edge !== segment.edge)) {
      const crosses =
        left <= Math.max(other.start[0]!, other.end[0]!) &&
        right >= Math.min(other.start[0]!, other.end[0]!) &&
        top <= Math.max(other.start[1]!, other.end[1]!) &&
        bottom >= Math.min(other.start[1]!, other.end[1]!);
      expect(crosses, segment.edge + ' crosses ' + other.edge).toBe(false);
    }
  }
});

it('serves the backend console, local module and editable scene independently of shopper routes', async () => {
  const page = await app.inject('/architecture');
  expect(page.statusCode).toBe(200);
  expect(page.headers['content-type']).toContain('text/html');
  expect(page.body).toContain('Backend architecture console');
  expect(page.body).toContain('data-node="client"');
  expect(page.body).toContain('data-node="postgres"');
  expect((await app.inject('/architecture.js')).headers['content-type']).toContain(
    'text/javascript',
  );
  const scene = (await app.inject('/architecture.excalidraw')).json();
  expect(scene).toMatchObject({ type: 'excalidraw', version: 2 });
  expect(scene.elements.find((node: { id: string }) => node.id === 'postgres')).toMatchObject({
    type: 'rectangle',
  });
  expect(scene.files.postgresql.dataURL).toContain('data:image/svg+xml;base64,');
  expect(backendDiagram()).toEqual(scene);
});

it('reports partial outages, redacts sampled secrets and validates the public snapshot contract', async () => {
  const time = new Date().toISOString();
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const route = new URL(url).pathname;
      if (url.includes(':4312')) throw new Error('private outage details');
      if (route === '/proxies')
        return new Response(
          JSON.stringify({ 'lab-rabbitmq': { enabled: false, upstream: 'private upstream' } }),
        );
      const data =
        route === '/activity'
          ? []
          : route === '/api/v1/cache'
            ? {
                connected: true,
                secret: 'must not be exposed',
                strategy: 'revisioned',
                ttlSeconds: 15,
                lastKey: null,
                counts: {},
                activeFills: 0,
                sampledAt: time,
              }
            : { ready: true, database: true, broker: true };
      return new Response(
        JSON.stringify({
          data,
          meta: { requestId: randomUUID(), correlationId: randomUUID(), respondedAt: time },
        }),
      );
    }),
  );
  const result = await app.inject('/api/v1/backend');
  expect(result.statusCode).toBe(200);
  const payload = result.json();
  expect(() => validateReply('/api/v1/backend', 'GET', payload)).not.toThrow();
  expect(
    payload.data.samples.find((value: { id: string }) => value.id === 'fulfillment'),
  ).toMatchObject({ available: false, data: null });
  expect(
    payload.data.samples.find((value: { id: string }) => value.id === 'redis').data.secret,
  ).toBe('[redacted]');
  expect(
    payload.data.samples.find((value: { id: string }) => value.id === 'toxiproxy').data,
  ).toEqual([{ name: 'lab-rabbitmq', enabled: false }]);
  expect(result.body).not.toContain('private outage');
  expect(result.body).not.toContain('private upstream');
  expect(calls.every((url) => !url.includes('/checkouts'))).toBe(true);
  expect(() =>
    validateReply('/api/v1/backend', 'GET', {
      ...payload,
      data: { ...payload.data, samples: [{ available: 'yes' }] },
    }),
  ).toThrow();
});

it('preserves a valid degraded 503 health report and rejects malformed health fields', async () => {
  let malformed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const route = new URL(url).pathname;
      if (route === '/proxies') return new Response('{}');
      const data =
        route === '/activity'
          ? []
          : route === '/health'
            ? { ready: false, database: malformed ? 'unknown' : false, broker: true }
            : {};
      return new Response(
        JSON.stringify({
          data,
          meta: {
            requestId: randomUUID(),
            correlationId: randomUUID(),
            respondedAt: new Date().toISOString(),
          },
        }),
        { status: route === '/health' ? 503 : 200 },
      );
    }),
  );
  const degraded = (await app.inject('/api/v1/backend')).json();
  expect(
    degraded.data.samples.find((sample: { id: string }) => sample.id === 'ordering'),
  ).toMatchObject({ available: true, data: { ready: false, database: false } });
  malformed = true;
  const invalid = (await app.inject('/api/v1/backend')).json();
  expect(
    invalid.data.samples.find((sample: { id: string }) => sample.id === 'ordering'),
  ).toMatchObject({ available: false, data: null });
});

it.each([
  {},
  { 'lab-rabbitmq': {} },
  { 'lab-rabbitmq': { enabled: 'false' } },
  { 'lab-rabbitmq': null },
])('keeps malformed or missing proxy evidence unavailable: %j', async (proxy) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(proxy))),
  );
  const payload = (await app.inject('/api/v1/backend')).json();
  expect(
    payload.data.samples.find((sample: { id: string }) => sample.id === 'toxiproxy'),
  ).toMatchObject({ available: false, data: null });
});
