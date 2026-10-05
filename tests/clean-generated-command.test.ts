import './runtime-fixture';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { projectRoot } from '@lab/runtime/configuration';

const state = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', async (original) => {
  const { promisify } = await import('node:util');
  return {
    ...(await original<object>()),
    execFile: Object.assign(vi.fn(), { [promisify.custom]: state.exec }),
  };
});
const exitCode = process.exitCode;
afterEach(() => {
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  state.exec.mockReset();
});

it.each([
  ['darwin', 4313],
  ['darwin', 5413],
  ['linux', 4313],
  ['linux', 5413],
] as const)(
  'refuses generated cleanup with an operator listener on %s port %i',
  async (platform, port) => {
    vi.resetModules();
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = projectRoot();
    if (port === 4313) fs.rmSync(path.join(root, '.env'), { force: true });
    else fs.writeFileSync(path.join(root, '.env'), `OPERATOR_URL=http://127.0.0.1:${port}\n`);
    fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(root, 'coverage/proof'), 'retain this artifact');
    // Only OS listener inspection is substituted; the command, deletion guard and retained receipt are real.
    state.exec.mockImplementation(async (command: string, args: string[]) => {
      const ports =
        command === 'lsof'
          ? args
              .find((arg) => arg.startsWith('-iTCP:'))!
              .slice(6)
              .split(',')
              .map(Number)
          : [Number(args.at(-1)!.split(':')[1])];
      if (ports.includes(port)) return { stdout: 'fixture listener\n', stderr: '' };
      if (command === 'lsof') throw Object.assign(new Error('No listeners'), { code: 1 });
      return { stdout: '', stderr: '' };
    });
    await import('../tools/clean-generated');
    const report = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(report).toMatchObject({ verified: false, results: [], errors: [expect.any(String)] });
    expect(process.exitCode).toBe(1);
    expect(fs.readFileSync(path.join(root, 'coverage/proof'), 'utf8')).toBe('retain this artifact');
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, '.lab/reports', `generated-${report.id}.json`), 'utf8'),
      ),
    ).toMatchObject({ verified: false });
  },
);
