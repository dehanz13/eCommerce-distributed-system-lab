import './runtime-fixture';
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
  retiringSocket: false,
  commands: [] as { file: string; args: string[] }[],
  failCompose: false,
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
      state.commands.push({ file, args });
      if (file === 'docker') {
        if (state.failCompose && args.includes('down')) throw new Error('fixture teardown failure');
        return { stdout: '', stderr: '' };
      }
      if (file === 'ps') return { stdout: '128\n', stderr: '' };
      if (file === 'ssh')
        return {
          stdout: args.at(-1)?.includes('python3')
            ? JSON.stringify({
                totalMemoryBytes: 1000,
                freeMemoryBytes: 500,
                diskFreeBytes: 2000,
                loadAverage: [0, 0, 0],
                managedResidentBytes: null,
              })
            : '',
          stderr: '',
        };
      if (file === 'ss') {
        if (state.retiringSocket && !state.listeners.length) {
          state.retiringSocket = false;
          return { stdout: 'LISTEN 0 511 127.0.0.1:4313 0.0.0.0:*', stderr: '' };
        }
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
      }
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
const { startService, stopService, stopLab, readCleanup, execute } = await import(
  '../tools/operations'
);
const kill = vi.spyOn(process, 'kill');
beforeEach(() => {
  state.listeners = [];
  state.cwd.clear();
  state.spawned = [];
  state.commands = [];
  state.failCompose = false;
  state.hiddenOwner = false;
  state.retiringSocket = false;
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

it('waits for a retiring Linux socket after its owned process has stopped', async () => {
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  try {
    await startService('operator');
    state.retiringSocket = true;
    await stopService('operator');
    expect(state.retiringSocket).toBe(false);
    expect(state.listeners).toEqual([]);
  } finally {
    platform.mockRestore();
  }
});

it('tears down only the lab project without deleting volumes and saves measured shutdown evidence', async () => {
  const report = await stopLab();
  expect(report.verified).toBe(true);
  expect(report.services).toHaveLength(7);
  expect(report.services.every((x) => x.running === false)).toBe(true);
  const teardown = state.commands.find((x) => x.args.includes('down'))!;
  expect(teardown.args).toContain('--remove-orphans');
  expect(teardown.args).not.toContain('-v');
  expect(readCleanup()?.id).toBe(report.id);
  expect(report.hosts[0]?.after.totalMemoryBytes).toBeGreaterThan(0);
});
it('continues container cleanup after an unowned local listener and never certifies it as stopped', async () => {
  state.listeners = [85021];
  state.cwd.set(85021, '/another/checkout');
  await expect(stopLab()).rejects.toThrow('could not be verified');
  expect(state.commands.some((x) => x.args.includes('down'))).toBe(true);
  expect(kill).not.toHaveBeenCalled();
  expect(readCleanup()?.verified).toBe(false);
  expect(readCleanup()?.services.some((x) => x.running)).toBe(true);
});
it('persists an unverified report when the container host fails cleanup', async () => {
  state.failCompose = true;
  await expect(stopLab()).rejects.toThrow('could not be verified');
  expect(readCleanup()?.errors).toEqual([
    'Compose teardown failed; inspect the configured container host.',
  ]);
});
it('restarts the entire lab only after verified teardown and returns its stop report', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify({ data: { ready: true } })));
  try {
    const report = await execute('restart');
    expect(report?.action).toBe('restart');
    const down = state.commands.findIndex((x) => x.args.includes('down'));
    const up = state.commands.findIndex((x) => x.args.includes('up'));
    expect(down).toBeGreaterThanOrEqual(0);
    expect(up).toBeGreaterThan(down);
  } finally {
    fetch.mockRestore();
  }
});
it('releases only the configured dedicated guest and reports its retained disk', async () => {
  const { cfg } = await import('@lab/runtime');
  const previous = { ...cfg };
  Object.assign(cfg, {
    TOPOLOGY: 'two',
    REMOTE_USER: 'fixture',
    REMOTE_HOST: 'fixture-host',
    REMOTE_DIR: '/lab',
    REMOTE_VM: 'lab-fixture',
  });
  try {
    const report = await execute('poweroff');
    expect(report?.verified).toBe(true);
    expect(
      state.commands.some(
        (x) => x.file === 'ssh' && x.args.at(-1) === "limactl stop 'lab-fixture'",
      ),
    ).toBe(true);
    expect(report?.hosts.map((x) => x.scope)).toEqual(['operator host', 'remote host']);
    expect(report?.retained).toContain(
      'Configured lab guest is stopped; its virtual disk remains on disk.',
    );
  } finally {
    Object.assign(cfg, previous);
  }
});
