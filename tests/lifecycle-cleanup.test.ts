import './runtime-fixture';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { closeResources } from '@lab/runtime/lifecycle';
import { cleanGenerated } from '../tools/generated-cleanup';
import { loop } from '@lab/runtime';
import { vi } from 'vitest';
const folders: string[] = [];
/** Give each cleanup case an isolated fixture directory; no running lab or user files are targets. */
function folder() {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-cleanup-'));
  folders.push(result);
  return result;
}
afterEach(() => {
  for (const item of folders.splice(0)) fs.rmSync(item, { recursive: true, force: true });
});

it('continues shutdown after failure/timeout and records every owned closer without leaking its error', async () => {
  const root = folder();
  const closed: string[] = [];
  const report = await closeResources(
    'ordering',
    [
      {
        name: 'HTTP',
        close: () => {
          closed.push('HTTP');
        },
      },
      {
        name: 'broker',
        close: () => {
          throw new Error('private fixture credential');
        },
      },
      { name: 'stalled', close: () => new Promise(() => {}) },
      {
        name: 'database',
        close: () => {
          closed.push('database');
        },
      },
    ],
    root,
    10,
  );
  expect(closed).toEqual(['HTTP', 'database']);
  expect(report.verified).toBe(false);
  expect(report.resources.map((item) => item.closed)).toEqual([true, false, false, true]);
  const saved = fs.readFileSync(
    path.join(root, '.lab/reports', `shutdown-${report.id}.json`),
    'utf8',
  );
  expect(saved).not.toContain('private fixture credential');
  expect(JSON.parse(saved)).toMatchObject({ owner: 'ordering', verified: false });
});
it('removes only allowlisted generated files and retains recovery, source, configuration and evidence', async () => {
  const root = folder();
  for (const relative of [
    'apps/web/.next/cache',
    'coverage/results.json',
    'test-results/trace.zip',
    '.lab/browser.env',
    '.lab/feeder.json',
    '.env',
    'source.ts',
  ]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixture');
  }
  const report = await cleanGenerated(root, async () => {});
  expect(report.verified).toBe(true);
  expect(fs.existsSync(path.join(root, 'apps/web/.next'))).toBe(false);
  for (const relative of [
    '.lab/feeder.json',
    '.env',
    'source.ts',
    `.lab/reports/generated-${report.id}.json`,
  ])
    expect(fs.existsSync(path.join(root, relative))).toBe(true);
});
it('saves a refused-cleanup report and leaves artifacts intact when local state is active or unknown', async () => {
  const root = folder();
  fs.mkdirSync(path.join(root, 'coverage'));
  fs.writeFileSync(path.join(root, 'coverage/proof'), 'retained');
  const report = await cleanGenerated(root, async () => {
    throw new Error('active listener');
  });
  expect(report.verified).toBe(false);
  expect(report.results).toEqual([]);
  expect(fs.existsSync(path.join(root, 'coverage/proof'))).toBe(true);
  expect(fs.existsSync(path.join(root, '.lab/reports', `generated-${report.id}.json`))).toBe(true);
});
it('drains in-flight owner work before releasing its scheduling loop', async () => {
  vi.useFakeTimers();
  try {
    let finish!: () => void;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = loop('cleanup-fixture', task, 20);
    await vi.advanceTimersByTimeAsync(20);
    let drained = false;
    const closing = stop().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await closing;
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(1);
    expect(drained).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it('refuses a symlinked artifact ancestor and never deletes its external target', async () => {
  const root = folder();
  const external = folder();
  fs.mkdirSync(path.join(external, '.next'));
  fs.writeFileSync(path.join(external, '.next/proof'), 'outside');
  fs.mkdirSync(path.join(root, 'apps'));
  fs.symlinkSync(external, path.join(root, 'apps/web'));
  const report = await cleanGenerated(root, async () => {});
  expect(report.verified).toBe(false);
  expect(fs.readFileSync(path.join(external, '.next/proof'), 'utf8')).toBe('outside');
});
