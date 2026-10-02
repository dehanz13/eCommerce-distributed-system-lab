import './runtime-fixture';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const state = vi.hoisted(() => ({
  folder: '',
  fetch: vi.fn(),
}));
state.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-feeder-'));
vi.mock('@lab/runtime', async (original) => ({
  ...(await original<object>()),
  root: state.folder,
  activity: vi.fn(),
}));

const { feeder } = await import('../tools/feeder');
afterAll(() => {
  fs.rmSync(state.folder, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
const at = new Date().toISOString();
const product = {
  id: randomUUID(),
  name: 'Fictional item',
  description: '',
  priceCents: 125,
  availableStock: 100,
  active: true,
  createdAt: at,
  updatedAt: at,
  deactivatedAt: null,
};
const cart = {
  id: randomUUID(),
  shopperId: randomUUID(),
  revision: 1,
  items: [],
  createdAt: at,
  updatedAt: at,
};
const order = {
  id: randomUUID(),
  shopperId: cart.shopperId,
  status: 'accepted',
  totalCents: 0,
  correlationId: randomUUID(),
  createdAt: at,
  updatedAt: at,
  items: [],
  failedAt: null,
  fulfilledAt: null,
};
function reply(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      data,
      meta: { requestId: randomUUID(), correlationId: randomUUID(), respondedAt: at },
    }),
    { status },
  );
}
function healthy(url: string, options?: RequestInit) {
  const route = new URL(url).pathname;
  return reply(
    route.endsWith('/checkouts')
      ? order
      : route.endsWith('/preview')
        ? {
            cartId: cart.id,
            revision: 1,
            items: [],
            totalCents: 0,
            priceFingerprint: 'a'.repeat(64),
            observedAt: at,
          }
        : route.includes('/carts')
          ? cart
          : options?.method === 'GET'
            ? [product]
            : product,
  );
}
it('preserves an unknown checkout and recovers its original submission before another run', async () => {
  let lost = true;
  vi.stubGlobal('fetch', state.fetch);
  state.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    const route = new URL(url).pathname;
    if (route === '/api/v1/checkouts') {
      if (lost) {
        lost = false;
        throw new TypeError('Response lost');
      }
      return reply(order);
    }
    if (route.endsWith('/preview'))
      return reply({
        cartId: cart.id,
        revision: 1,
        items: [],
        totalCents: 0,
        priceFingerprint: 'a'.repeat(64),
        observedAt: at,
      });
    return reply(
      route.includes('/carts')
        ? cart
        : route === '/api/v1/products' && options?.method === 'GET'
          ? [product]
          : product,
    );
  });
  const run = feeder.start({ shoppers: 1, concurrency: 1, seed: 1, thinkMs: 0 });
  await vi.waitFor(() => expect(run.status).toBe('completed'));
  expect(run.unknown).toBe(1);
  expect(run.unresolved).toHaveLength(1);
  const retained = run.unresolved[0]!;
  const persisted = JSON.parse(fs.readFileSync(state.folder + '/.lab/feeder.json', 'utf8'));
  expect(persisted.unresolved[0]).toEqual(retained);
  expect(() => feeder.start(run.options)).toThrow('Recover the retained');
  await feeder.recover(retained.key);
  const calls = state.fetch.mock.calls.filter((x) => String(x[0]).endsWith('/api/v1/checkouts'));
  expect(calls[0]![1].body).toEqual(calls[1]![1].body);
  expect(calls[0]![1].headers['idempotency-key']).toEqual(calls[1]![1].headers['idempotency-key']);
  expect(run.accepted).toBe(1);
  expect(run.unknown).toBe(0);
  expect(run.unresolved).toHaveLength(0);
  expect(run.outcomes.at(-1)).toMatchObject({ outcome: 'recovered', orderId: order.id });
  expect(fs.existsSync(state.folder + '/.lab/feeder.json.tmp')).toBe(false);
});

it('runs accepted and abandoned shopper journeys and accounts for their requests', async () => {
  state.fetch.mockImplementation(healthy);
  const run = feeder.start({ shoppers: 30, concurrency: 4, seed: 42, thinkMs: 0 });
  expect(() => feeder.start(run.options)).toThrow('Stop or finish');
  await expect(feeder.recover(randomUUID())).rejects.toMatchObject({ code: 'FEEDER_RUNNING' });
  await vi.waitFor(() => expect(run.status).toBe('completed'));
  expect(run.finished).toBe(30);
  expect(run.active).toBe(0);
  expect(run.accepted + run.abandoned).toBe(30);
  expect(run.abandoned).toBeGreaterThan(0);
  expect(run.accepted).toBeGreaterThan(0);
  expect(run.requestErrors).toBe(0);
  expect(run.unresolved).toHaveLength(0);
  expect(run.requestCount).toBe(3 + run.abandoned * 3 + run.accepted * 5);
  await expect(feeder.recover(randomUUID())).rejects.toMatchObject({
    code: 'SUBMISSION_NOT_FOUND',
  });
});
it('stops new shoppers, finishes active work and retains a terminal run report', async () => {
  state.fetch.mockImplementation(healthy);
  const run = feeder.start({ shoppers: 30, concurrency: 1, seed: 42, thinkMs: 0 });
  feeder.stop();
  await vi.waitFor(() => expect(run.status).toBe('stopped'));
  expect(run.started).toBe(0);
  expect(run.active).toBe(0);
  expect(feeder.stop()?.status).toBe('stopped');
});
it('clears definitive checkout rejections but retains transport failures for recovery', async () => {
  state.fetch.mockImplementation((url: string, options?: RequestInit) =>
    String(url).endsWith('/checkouts')
      ? new Response(JSON.stringify({ code: 'INSUFFICIENT_STOCK', detail: 'No stock' }), {
          status: 409,
        })
      : healthy(url, options),
  );
  const run = feeder.start({ shoppers: 1, concurrency: 1, seed: 1, thinkMs: 0 });
  await vi.waitFor(() => expect(run.status).toBe('completed'));
  expect(run).toMatchObject({ rejected: 1, unknown: 0, requestErrors: 1 });
  expect(run.unresolved).toHaveLength(0);
  state.fetch.mockImplementation((url: string, options?: RequestInit) =>
    String(url).endsWith('/checkouts')
      ? Promise.reject(new TypeError('offline'))
      : healthy(url, options),
  );
  const unknown = feeder.start(run.options);
  await vi.waitFor(() => expect(unknown.status).toBe('completed'));
  const pending = unknown.unresolved[0]!;
  await expect(feeder.recover(pending.key)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(unknown.unresolved).toHaveLength(1);
  state.fetch.mockImplementation(
    () =>
      new Response(JSON.stringify({ code: 'CART_CHANGED', detail: 'Reconfirm' }), { status: 409 }),
  );
  await expect(feeder.recover(pending.key)).rejects.toMatchObject({ code: 'CART_CHANGED' });
  expect(unknown.unresolved).toHaveLength(0);
  expect(unknown.unknown).toBe(0);
  expect(unknown.rejected).toBe(1);
});
it('records a failed catalog setup without starting shopper transactions', async () => {
  state.fetch.mockRejectedValue(new TypeError('offline'));
  const run = feeder.start({ shoppers: 1, concurrency: 1, seed: 1, thinkMs: 0 });
  await vi.waitFor(() => expect(run.status).toBe('completed'));
  expect(run.error).toContain('Connection lost');
  expect(run.started).toBe(0);
  expect(run.requestErrors).toBe(1);
});
