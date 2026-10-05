import './runtime-fixture';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ spawn: vi.fn(() => ({ status: 0 })) }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<object>()),
  spawnSync: state.spawn,
}));
const { cfg } = await import('@lab/runtime');
const original = { ...cfg };
afterEach(() => {
  Object.assign(cfg, original);
  vi.restoreAllMocks();
  state.spawn.mockClear();
});

it.each(['single', 'two'] as const)(
  'opens the %s guest monitor on its owning host',
  async (topology) => {
    vi.resetModules();
    const { cfg } = await import('@lab/runtime');
    Object.assign(cfg, {
      TOPOLOGY: topology,
      REMOTE_VM: 'lab-fixture',
      REMOTE_HOST: topology === 'two' ? 'fixture-host' : '',
      REMOTE_USER: topology === 'two' ? 'fixture' : '',
    });
    const argv = vi
      .spyOn(process, 'argv', 'get')
      .mockReturnValue(['node', 'cli', 'monitor', 'lab-vm']);
    try {
      await import('../tools/cli');
      expect(state.spawn).toHaveBeenCalledWith(
        topology === 'single' ? 'limactl' : 'ssh',
        topology === 'single'
          ? ['shell', 'lab-fixture', 'btop']
          : ['-t', 'fixture@fixture-host', 'limactl shell lab-fixture btop'],
        { stdio: 'inherit' },
      );
    } finally {
      argv.mockRestore();
    }
  },
);
