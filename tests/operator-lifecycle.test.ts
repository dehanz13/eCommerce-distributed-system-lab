import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  root: '',
  listeners: [] as number[],
  cwd: new Map<number, string>(),
  spawned: [] as string[][],
  hiddenOwner: false,
}));
state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-lifecycle-'));
vi.mock('@lab/runtime', async (original) => ({
  ...(await original<object>()),
  root: state.root,
}));
vi.mock('node:child_process', async (original) => {
  const actual = await original<object>();
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async (file: string, args: string[]) => {
      if (file === 'ss')
        return {
          stdout: state.hiddenOwner
            ? 'LISTEN 0 511 127.0.0.1:4313 0.0.0.0:*'
            : state.listeners
                .map(
                  (pid) =>
                    `LISTEN 0 511 127.0.0.1:4313 0.0.0.0:* users:(("next-server (v1",pid=${pid},fd=18))`,
                )
                .join('\n'),
          stderr: '',
        };
      if (file === 'readlink')
        return { stdout: state.cwd.get(Number(args[0]!.split('/')[2])) + '\n', stderr: '' };
      if (args[0] === '-t') return { stdout: state.listeners.join('\n'), stderr: '' };
      return { stdout: 'n' + state.cwd.get(Number(args[2])), stderr: '' };
    },
  });
  return {
    ...actual,
    execFile,
    spawn: (_file: string, args: string[]) => {
      state.spawned.push(args);
      state.listeners = [12345];
      state.cwd.set(12345, state.root);
      return Object.assign(new EventEmitter(), {
        pid: 12345,
        exitCode: null,
        signalCode: null,
        unref() {},
      });
    },
  };
});
const { startService, stopService } = await import('../tools/operations');
const kill = vi.spyOn(process, 'kill');
beforeEach(() => {
  state.listeners = [];
  state.cwd.clear();
  state.spawned = [];
  state.hiddenOwner = false;
  fs.rmSync(path.join(state.root, '.lab/operator.pid'), { force: true });
  kill.mockReset().mockImplementation((pid, signal) => {
    if (signal === 0) throw Object.assign(new Error('Gone'), { code: 'ESRCH' });
    state.listeners = state.listeners.filter((active) => active !== pid);
    return true;
  });
});
afterAll(() => {
  kill.mockRestore();
  fs.rmSync(state.root, { recursive: true, force: true });
});
it('stops an owned orphan listener even when the recorded launcher has exited', async () => {
  fs.writeFileSync(path.join(state.root, '.lab/operator.pid'), '99999');
  state.listeners = [85021];
  state.cwd.set(85021, state.root);
  await stopService('operator');
  expect(kill).toHaveBeenCalledWith(85021, 'SIGKILL');
  expect(state.listeners).toEqual([]);
});
it('refuses both stopping and starting over a listener from another checkout', async () => {
  state.listeners = [85021];
  state.cwd.set(85021, '/some/other/project');
  await expect(stopService('operator')).rejects.toThrow('another checkout');
  await expect(startService('operator')).rejects.toThrow('another checkout');
  expect(kill).not.toHaveBeenCalled();
  expect(state.spawned).toEqual([]);
});
it('starts TypeScript in the recorded process and verifies that it owns the listener', async () => {
  await startService('operator');
  expect(state.spawned[0]![0]).toBe('--import');
  expect(state.spawned[0]![2]).toBe(state.root + '/apps/operator/src/main.ts');
  expect(fs.readFileSync(path.join(state.root, '.lab/operator.pid'), 'utf8')).toBe('12345');
});

it('accepts Linux socket ownership despite a truncated Next process name', async () => {
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  try {
    await startService('operator');
    await stopService('operator');
    expect(state.listeners).toEqual([]);
    state.listeners = [85021];
    state.cwd.set(85021, '/some/other/project');
    await expect(stopService('operator')).rejects.toThrow('another checkout');
  } finally {
    platform.mockRestore();
  }
});

it('refuses Linux lifecycle changes when a listening socket hides its owner', async () => {
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  try {
    state.hiddenOwner = true;
    await expect(startService('operator')).rejects.toThrow('ownership is unavailable');
    await expect(stopService('operator')).rejects.toThrow('ownership is unavailable');
    expect(state.spawned).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  } finally {
    platform.mockRestore();
  }
});
