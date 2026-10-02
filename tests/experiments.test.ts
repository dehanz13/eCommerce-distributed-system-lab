import './runtime-fixture';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { faultNames } from '@lab/contracts';
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
