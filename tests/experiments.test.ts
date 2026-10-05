import './runtime-fixture';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { faultNames } from '@lab/contracts';
import { installShutdown } from '@lab/runtime/lifecycle';
const state = vi.hoisted(() => ({
  folder: '',
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  execute: vi.fn(),
}));
state.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-experiments-'));
vi.mock('@lab/runtime', async (original) => ({
  ...(await original<object>()),
  root: state.folder,
}));
// Named host operations form the boundary: tests never stop a developer's processes.
vi.mock('../tools/operations', () => ({
  status: state.status,
  startService: state.start,
  stopService: state.stop,
  execute: state.execute,
}));
const { experiments } = await import('../tools/experiments');
beforeEach(() => {
  fs.rmSync(state.folder + '/.lab/experiment.json', { force: true });
  vi.useFakeTimers();
  state.status.mockResolvedValue({
    services: [
      { name: 'ordering', ready: true },
      { name: 'fulfillment', ready: true },
    ],
  });
  state.start.mockResolvedValue(undefined);
  state.stop.mockResolvedValue(undefined);
  state.execute.mockResolvedValue(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: { settings: { preset: 'success' } } }))),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
afterAll(() => fs.rmSync(state.folder, { recursive: true, force: true }));
it.each(faultNames)(
  'captures and restores the %s exercise with bounded progress',
  async (scenario) => {
    const run = experiments.start({ scenario, durationSeconds: 3 });
    expect(experiments.busy()).toBe(true);
    expect(() => experiments.start(run.options)).toThrow('Wait for the active exercise');
    await vi.advanceTimersByTimeAsync(10000);
    expect(run).toMatchObject({ status: 'completed', restoration: 'completed' });
    expect(run.before).toBeDefined();
    expect(run.during).toBeDefined();
    expect(run.after).toBeDefined();
    expect(run.finishedAt).not.toBeNull();
    expect(experiments.busy()).toBe(false);
    const persisted = JSON.parse(fs.readFileSync(state.folder + '/.lab/experiment.json', 'utf8'));
    expect(persisted.id).toBe(run.id);
    expect(persisted.status).toBe('completed');
    expect(fs.existsSync(state.folder + '/.lab/experiment.json.tmp')).toBe(false);
    if (scenario.endsWith('outage') || scenario === 'fulfillment-restart') {
      const target =
        scenario === 'cache-outage'
          ? 'redis'
          : scenario === 'broker-outage'
            ? 'rabbitmq'
            : scenario === 'database-outage'
              ? 'postgres'
              : 'fulfillment';
      expect(state.stop).toHaveBeenCalledWith(target);
      expect(state.start).toHaveBeenCalledWith(target);
    } else if (scenario.endsWith('processing')) {
      expect(state.execute).toHaveBeenLastCalledWith('preset', undefined, 'success');
    } else {
      const calls = vi.mocked(fetch).mock.calls;
      const changes = calls.filter(([url]) => String(url).includes('/proxies/'));
      expect(changes).toHaveLength(2);
      if (scenario === 'network-cut') {
        expect(JSON.parse(String(changes[0]?.[1]?.body))).toEqual({ enabled: false });
        expect(JSON.parse(String(changes[1]?.[1]?.body))).toEqual({ enabled: true });
      } else {
        expect(JSON.parse(String(changes[0]?.[1]?.body))).toMatchObject({
          attributes: { latency: 750, jitter: 0 },
        });
        expect(changes[1]?.[1]?.method).toBe('DELETE');
      }
    }
  },
);
it('refuses an unhealthy baseline and records unavailable snapshots', async () => {
  state.status.mockResolvedValue({ services: [{ name: 'ordering', ready: false }] });
  vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
  const run = experiments.start({ scenario: 'broker-outage', durationSeconds: 3 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(run.status).toBe('failed');
  expect(run.error).toContain('healthy owner services');
  expect(run.before).toMatchObject({ ordering: { unavailable: true } });
  expect(state.stop).not.toHaveBeenCalled();
});
it('requires explicit restoration after cleanup fails, then restores only named lab targets', async () => {
  state.start.mockRejectedValueOnce(Error('cannot restart redis'));
  const run = experiments.start({ scenario: 'cache-outage', durationSeconds: 3 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(run).toMatchObject({ status: 'failed', restoration: 'failed' });
  expect(() => experiments.start(run.options)).toThrow('Restore the previous exercise');
  await experiments.restore();
  expect(experiments.inspect()?.restoration).toBe('completed');
  expect(state.start.mock.calls.slice(-4).map(([name]) => name)).toEqual([
    'postgres',
    'rabbitmq',
    'redis',
    'fulfillment',
  ]);
  expect(state.execute).toHaveBeenCalledWith('resume');
});
it('records a proxy mutation failure without reporting the exercise as successful', async () => {
  vi.mocked(fetch).mockImplementation(
    async (url) =>
      new Response(JSON.stringify({}), { status: String(url).includes('/proxies/') ? 503 : 200 }),
  );
  const run = experiments.start({ scenario: 'network-cut', durationSeconds: 3 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(run).toMatchObject({ status: 'failed', restoration: 'failed' });
  expect(run.error).toContain('proxy unavailable: 503');
  vi.mocked(fetch).mockImplementation(
    async (url, options) =>
      new Response(JSON.stringify({}), { status: options?.method === 'DELETE' ? 404 : 200 }),
  );
  await experiments.restore();
  expect(run.restoration).toBe('completed');
});

it('drains an interrupted exercise and awaits restoration before shutdown can finish', async () => {
  vi.resetModules();
  const { experiments: active } = await import('../tools/experiments');
  let release!: () => void;
  state.start.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const run = active.start({ scenario: 'cache-outage', durationSeconds: 30 });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.stop).toHaveBeenCalledWith('redis');
  let closed = false;
  const draining = active.close().then(() => {
    closed = true;
  });
  await vi.advanceTimersByTimeAsync(6000);
  expect(state.start).toHaveBeenCalledWith('redis');
  expect(closed).toBe(false);
  expect(() => active.start(run.options)).toThrow('shutting down');
  release();
  await draining;
  expect(run).toMatchObject({ status: 'interrupted', restoration: 'completed' });
  expect(run.after).toBeDefined();
  expect(JSON.parse(fs.readFileSync(state.folder + '/.lab/experiment.json', 'utf8'))).toMatchObject(
    { status: 'interrupted', restoration: 'completed' },
  );
});

it.each(faultNames)(
  'restores the %s fault when shutdown interrupts its active window',
  async (scenario) => {
    vi.resetModules();
    const { experiments: active } = await import('../tools/experiments');
    const run = active.start({ scenario, durationSeconds: 30 });
    await vi.advanceTimersByTimeAsync(0);
    await active.close();
    expect(run).toMatchObject({ status: 'interrupted', restoration: 'completed' });
    expect(run.finishedAt).not.toBeNull();
    if (scenario === 'network-cut') {
      const changes = vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).includes('/proxies/'));
      expect(changes.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
        { enabled: false },
        { enabled: true },
      ]);
    } else if (scenario === 'network-latency') {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url, options]) =>
              String(url).endsWith('/toxics/lab-latency') && options?.method === 'DELETE',
          ),
      ).toBe(true);
    } else if (scenario.endsWith('processing')) {
      expect(state.execute).toHaveBeenLastCalledWith('preset', undefined, 'success');
    } else {
      expect(state.start).toHaveBeenCalledWith(state.stop.mock.calls[0]![0]);
    }
  },
);

it('reports failed shutdown restoration and retains explicit recovery state', async () => {
  vi.resetModules();
  const { experiments: active } = await import('../tools/experiments');
  state.start.mockRejectedValueOnce(Error('fixture restart failed'));
  const run = active.start({ scenario: 'cache-outage', durationSeconds: 30 });
  await vi.advanceTimersByTimeAsync(0);
  await expect(active.close()).rejects.toThrow('restoration failed');
  expect(run).toMatchObject({ status: 'failed', restoration: 'failed' });
});

it('restores the active fault even if writing its shutdown progress fails', async () => {
  vi.resetModules();
  const { experiments: active } = await import('../tools/experiments');
  const run = active.start({ scenario: 'cache-outage', durationSeconds: 30 });
  await vi.advanceTimersByTimeAsync(0);
  const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
    throw Error('fixture disk full');
  });
  try {
    await expect(active.close()).rejects.toThrow();
    expect(state.start).toHaveBeenCalledWith('redis');
    expect(run.restoration).toBe('completed');
  } finally {
    write.mockRestore();
  }
});

it('does not apply a fault if shutdown arrives while the baseline is being captured', async () => {
  vi.resetModules();
  const { experiments: active } = await import('../tools/experiments');
  const run = active.start({ scenario: 'network-cut', durationSeconds: 30 });
  await active.close();
  expect(run).toMatchObject({ status: 'interrupted', restoration: 'completed' });
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/proxies/'))).toBe(
    false,
  );
});

it('does not exit on SIGTERM until the active exercise has restored its dependency', async () => {
  vi.resetModules();
  const { experiments: active } = await import('../tools/experiments');
  let release!: () => void;
  state.start.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const run = active.start({ scenario: 'cache-outage', durationSeconds: 30 });
  await vi.advanceTimersByTimeAsync(0);
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const before = signals.map((signal) => new Set(process.listeners(signal)));
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    installShutdown('operator-fixture', [
      { name: 'exercise restoration', timeoutMs: 180000, close: () => active.close() },
    ]);
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(6000);
    expect(exit).not.toHaveBeenCalled();
    expect(state.start).toHaveBeenCalledWith('redis');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(run.restoration).toBe('completed');
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  } finally {
    signals.forEach((signal, index) => {
      for (const listener of process.listeners(signal))
        if (!before[index]!.has(listener)) process.removeListener(signal, listener);
    });
    exit.mockRestore();
    output.mockRestore();
  }
});
