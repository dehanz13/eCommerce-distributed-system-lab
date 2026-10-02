import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { ApiError } from '@lab/client';
const state = vi.hoisted(() => ({
  folder: '',
  request: vi.fn(),
}));
state.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-feeder-'));
vi.mock('@lab/runtime', async (original) => ({
  ...(await original<object>()),
  root: state.folder,
  activity: vi.fn(),
}));
vi.mock('@lab/client', async (original) => ({
  ...(await original<object>()),
  request: state.request,
}));
const { feeder } = await import('../tools/feeder');
afterAll(() => fs.rmSync(state.folder, { recursive: true, force: true }));
it('preserves an unknown checkout and recovers its original submission before another run', async () => {
  let lost = true;
  state.request.mockImplementation(async (route: string) => {
    if (route === '/api/v1/checkouts') {
      if (lost) {
        lost = false;
        throw new ApiError(0, 'OUTCOME_UNKNOWN', 'Response lost');
      }
      return { data: { id: 'original-order' } };
    }
    if (route.endsWith('/preview'))
      return { data: { revision: 1, priceFingerprint: 'a'.repeat(64) } };
    return { data: { id: 'fixture' } };
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
  const calls = state.request.mock.calls.filter((x) => x[0] === '/api/v1/checkouts');
  expect(calls[0]![1].body).toEqual(calls[1]![1].body);
  expect(calls[0]![1].headers['idempotency-key']).toEqual(calls[1]![1].headers['idempotency-key']);
  expect(run.accepted).toBe(1);
  expect(run.unknown).toBe(0);
  expect(run.unresolved).toHaveLength(0);
  expect(run.outcomes.at(-1)).toMatchObject({ outcome: 'recovered', orderId: 'original-order' });
  expect(fs.existsSync(state.folder + '/.lab/feeder.json.tmp')).toBe(false);
});
