import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { request } from '@lab/client';
import { cfg, root } from '@lab/runtime';
import {
  faultNames,
  type Product,
  type Cart,
  type Preview,
  type Order,
  type ExperimentRun,
} from '@lab/contracts';
const api = <T>(
  base: string,
  route: string,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
) =>
  request<T>(
    route,
    { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) },
    base,
  ).then((r) => r.data);
const ordering = <T>(
  route: string,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
) => api<T>(cfg.ORDERING_URL, '/api/v1' + route, method, body, headers);
const operator = <T>(route: string, method = 'GET', body?: unknown) =>
  api<T>(cfg.OPERATOR_URL, '/api/v1' + route, method, body);
async function until<T>(read: () => Promise<T>, predicate: (x: T) => boolean, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('Observation deadline exceeded');
}
const settings = (preset: string) =>
  api(cfg.FULFILLMENT_URL, '/api/v1/settings', 'PUT', { preset, paused: false });
const product = await ordering<Product>('/products', 'POST', {
  name: 'Failure exercise specimen ' + randomUUID().slice(0, 8),
  description: 'Bounded fictional acceptance checks',
  priceCents: 125,
  availableStock: 30,
});
const evidence: unknown[] = [];
async function prepare() {
  const cart = await ordering<Cart>('/carts', 'POST', { shopperId: randomUUID() });
  await ordering(`/carts/${cart.id}/items/${product.id}`, 'PUT', { quantity: 1 });
  const preview = await ordering<Preview>(`/carts/${cart.id}/preview`);
  const key = randomUUID();
  return () =>
    ordering<Order>(
      '/checkouts',
      'POST',
      { cartId: cart.id, revision: preview.revision, priceFingerprint: preview.priceFingerprint },
      { 'idempotency-key': key },
    );
}
try {
  await settings('success');
  for (const scenario of faultNames) {
    const checkout = await prepare();
    let order: Order | undefined;
    if (scenario === 'fulfillment-restart') {
      await settings('slow');
      order = await checkout();
      await until(
        async () =>
          api<{ jobs: Array<{ orderId: string; status: string }> }>(
            cfg.FULFILLMENT_URL,
            '/api/v1/system',
          ),
        (x) => x.jobs.some((j) => j.orderId === order!.id && j.status === 'processing'),
      );
    }
    const started = await operator<ExperimentRun>('/experiments', 'POST', {
      scenario,
      durationSeconds: scenario === 'database-outage' ? 8 : scenario.endsWith('processing') ? 6 : 4,
    });
    await until(
      async () => (await operator<{ run: ExperimentRun }>('/experiments')).run,
      (x) => x.id === started.id && x.progress.startsWith('Fault active'),
    );
    let observation: unknown;
    if (scenario === 'cache-outage') {
      await ordering('/products');
      const cache = await ordering<{ counts: Record<string, number>; connected: boolean }>(
        '/cache',
      );
      assert.equal(cache.connected, false);
      assert((cache.counts.fallback ?? 0) > 0);
      observation = cache;
    } else if (scenario === 'database-outage') {
      const response = await fetch(cfg.ORDERING_URL + '/api/v1/products', {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 503);
      observation = await response.json();
    } else if (scenario !== 'fulfillment-restart') {
      if (scenario === 'broker-outage' || scenario === 'network-cut')
        await new Promise((r) => setTimeout(r, 700));
      order = await checkout();
      assert.equal(order.status, 'accepted');
      if (scenario === 'broker-outage' || scenario === 'network-cut') {
        const system = await ordering<{ pendingOutbox: string }>('/system');
        assert(+system.pendingOutbox > 0);
        observation = system;
      }
    }
    const finished = await until(
      async () => (await operator<{ run: ExperimentRun }>('/experiments')).run,
      (x) => x.id === started.id && x.status !== 'running',
      60000,
    );
    assert.equal(finished.status, 'completed', finished.error);
    assert.equal(finished.restoration, 'completed');
    assert(finished.before && finished.during && finished.after);
    if (order) {
      const terminal = await until(
        () => ordering<Order>(`/orders/${order!.id}`),
        (x) => x.status !== 'accepted',
      );
      assert.equal(terminal.status, scenario === 'failed-processing' ? 'failed' : 'fulfilled');
      if (scenario === 'failed-processing') {
        const before = await ordering<Product>(`/products/${product.id}`);
        await new Promise((r) => setTimeout(r, 1000));
        assert.equal(
          (await ordering<Product>(`/products/${product.id}`)).availableStock,
          before.availableStock,
        );
      }
      observation = { ...(observation ? { diagnostics: observation } : {}), order: terminal };
    }
    evidence.push({ scenario, run: finished, observation });
    console.log('Verified ' + scenario + '; restoration completed');
    await settings('success');
  }
  // Current revision changes atomically with a catalog write.
  await ordering('/products');
  const before = await ordering<{ lastKey: string }>('/cache');
  await ordering(`/products/${product.id}/stock`, 'POST', { delta: 1 });
  await ordering('/products');
  const after = await ordering<{ lastKey: string }>('/cache');
  assert.notEqual(after.lastKey, before.lastKey);
  evidence.push({ scenario: 'catalog-write-invalidation', before, after });
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'test-results/learning-integration.json'),
    JSON.stringify({ finishedAt: new Date().toISOString(), evidence }, null, 2),
  );
  console.log('All nine failure controls and catalog revision invalidation verified');
} finally {
  await operator('/experiments/restore', 'POST');
  await settings('success');
}
