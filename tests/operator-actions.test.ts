import './runtime-fixture';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeResources } from '@lab/runtime/lifecycle';
const state = vi.hoisted(() => ({
  root: '',
  app: undefined as FastifyInstance | undefined,
  resources: [] as Parameters<typeof closeResources>[1],
  execute: vi.fn(),
}));
state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-action-drain-'));
vi.mock('@lab/runtime', async (original) => {
  const actual = await original<typeof import('@lab/runtime')>();
  const { telemetry } = await import('@lab/runtime/telemetry');
  return {
    ...actual,
    root: state.root,
    server: async (owner: string) => {
      // Each imported startup represents a fresh process; clear its prior fixture metric registration.
      telemetry(owner).registry.clear();
      return actual.server(owner);
    },
    listen: async (app: FastifyInstance) => {
      state.app = app;
      await app.ready();
    },
  };
});
vi.mock('@lab/runtime/lifecycle', async (original) => ({
  ...(await original<object>()),
  installShutdown: (_owner: string, resources: Parameters<typeof closeResources>[1]) => {
    state.resources = resources;
  },
}));
// Named service execution is the external process boundary; routes, action state and shutdown/report code remain real.
vi.mock('../tools/operations', async (original) => ({
  ...(await original<object>()),
  execute: state.execute,
}));
beforeEach(() => {
  vi.resetModules();
  state.execute.mockReset();
  fs.mkdirSync(path.join(state.root, '.lab'), { recursive: true });
});
afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  await state.app?.close();
  fs.rmSync(state.root, { recursive: true, force: true });
});

it('drains an accepted action through its scheduling delay and running work before certifying shutdown', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  let release!: () => void;
  state.execute.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await import('../apps/operator/src/main');
  const response = await state.app!.inject({
    method: 'POST',
    url: '/api/v1/actions',
    payload: { name: 'restart', service: 'ordering' },
  });
  expect(response.statusCode).toBe(202);
  expect(
    (
      await state.app!.inject({
        method: 'POST',
        url: '/api/v1/actions',
        payload: { name: 'stop', service: 'ordering' },
      })
    ).statusCode,
  ).toBe(409);
  const id = response.json().data.id;
  let report: Awaited<ReturnType<typeof closeResources>> | undefined;
  const closing = closeResources('operator', state.resources, state.root).then((result) => {
    report = result;
    return result;
  });
  await vi.advanceTimersByTimeAsync(20);
  expect(report).toBeUndefined();
  await vi.advanceTimersByTimeAsync(6000);
  expect(state.execute).toHaveBeenCalledTimes(1);
  expect(report).toBeUndefined();
  release();
  expect((await closing).verified).toBe(true);
  const actions = JSON.parse(fs.readFileSync(path.join(state.root, '.lab/actions.json'), 'utf8'));
  expect(actions.find((action: { id: string }) => action.id === id)).toMatchObject({
    status: 'completed',
    finishedAt: expect.any(String),
  });
});

it('records stalled accepted work as unverified after its bounded shutdown deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  let release!: () => void;
  state.execute.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await import('../apps/operator/src/main');
  await state.app!.inject({
    method: 'POST',
    url: '/api/v1/actions',
    payload: { name: 'stop', service: 'ordering' },
  });
  const closing = closeResources('operator', state.resources, state.root);
  await vi.advanceTimersByTimeAsync(180001);
  const report = await closing;
  expect(report.verified).toBe(false);
  expect(
    report.resources.find(
      (resource) => resource.name === 'accepted lifecycle action and retained result',
    ),
  ).toMatchObject({ closed: false, diagnostic: expect.any(String) });
  const saved = JSON.parse(
    fs.readFileSync(path.join(state.root, '.lab/reports', `shutdown-${report.id}.json`), 'utf8'),
  );
  expect(saved.verified).toBe(false);
  release();
  await vi.advanceTimersByTimeAsync(0);
});

it('retains a failed action result before finishing the drain', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  state.execute.mockRejectedValue(new Error('Named service unavailable'));
  await import('../apps/operator/src/main');
  const response = await state.app!.inject({
    method: 'POST',
    url: '/api/v1/actions',
    payload: { name: 'restart', service: 'ordering' },
  });
  const closing = closeResources('operator', state.resources, state.root);
  await vi.advanceTimersByTimeAsync(60);
  expect((await closing).verified).toBe(true);
  const actions = JSON.parse(fs.readFileSync(path.join(state.root, '.lab/actions.json'), 'utf8'));
  expect(
    actions.find((action: { id: string }) => action.id === response.json().data.id),
  ).toMatchObject({
    status: 'failed',
    error: 'Named service unavailable',
    finishedAt: expect.any(String),
  });
});

it('reports an unverified drain when the accepted action result cannot be persisted', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let release!: () => void;
  state.execute.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    await import('../apps/operator/src/main');
    await state.app!.inject({
      method: 'POST',
      url: '/api/v1/actions',
      payload: { name: 'restart', service: 'ordering' },
    });
    const closing = closeResources('operator', state.resources, state.root);
    await vi.advanceTimersByTimeAsync(60);
    const file = path.join(state.root, '.lab/actions.json');
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    release();
    await vi.advanceTimersByTimeAsync(0);
    const report = await closing;
    expect(report.verified).toBe(false);
    expect(
      report.resources.find(
        (resource) => resource.name === 'accepted lifecycle action and retained result',
      )?.closed,
    ).toBe(false);
    expect(errors).toHaveBeenCalledWith(
      '[actions] Action state could not be saved; inspect .lab state permissions.',
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain(state.root);
  } finally {
    errors.mockRestore();
  }
});
