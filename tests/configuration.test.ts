import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  loadConfiguration,
  requireSettings,
  validateConfiguration,
} from '../packages/runtime/src/configuration';

const example = dotenv.parse(fs.readFileSync('.env.example'));
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

it('accepts the committed single-machine example and optional empty remote settings', () => {
  expect(validateConfiguration(example).TOPOLOGY).toBe('single');
});

it('reports all missing required settings together without substituting defaults', () => {
  const input = { ...example };
  delete input.PG_HOST;
  input.ORDERING_PASSWORD = '   ';
  expect(() => validateConfiguration(input)).toThrow(/missing PG_HOST; missing ORDERING_PASSWORD/);
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining('root .env against .env.example'),
  );
});

it.each(['0', '65536', '1.5', 'not-a-port'])('rejects an invalid dependency port: %s', (value) => {
  expect(() => validateConfiguration({ ...example, PG_PORT: value })).toThrow(
    'PG_PORT must be an integer',
  );
});

it.each([
  'not-a-url',
  'ftp://localhost',
  'http://localhost/path',
  'http://localhost?token=fixture',
  'http://localhost#fragment',
  'http://user:never-log-this@localhost',
])('rejects an unsafe service origin without logging its value', (value) => {
  expect(() => validateConfiguration({ ...example, ORDERING_URL: value })).toThrow('ORDERING_URL');
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(value);
});

it('requires remote host, account and directory only for two-machine operation', () => {
  expect(() => validateConfiguration({ ...example, TOPOLOGY: 'two' })).toThrow(
    /missing REMOTE_HOST.*missing REMOTE_USER.*missing REMOTE_DIR/,
  );
  expect(
    validateConfiguration({
      ...example,
      TOPOLOGY: 'two',
      REMOTE_HOST: 'lab.example',
      REMOTE_USER: 'lab',
      REMOTE_DIR: '/srv/lab',
    }).TOPOLOGY,
  ).toBe('two');
});

it('names missing optional settings when a command needs them', () => {
  expect(() =>
    requireSettings(validateConfiguration(example), ['REMOTE_HOST', 'REMOTE_BIND_IP']),
  ).toThrow(/missing REMOTE_HOST.*missing REMOTE_BIND_IP/);
});

it('reports a missing source file and the setup location without printing personal paths', () => {
  expect(() => loadConfiguration('/not-a-real-lab-location/.env')).toThrow(
    'configuration file is missing or unreadable',
  );
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    '/not-a-real-lab-location',
  );
});

it('loads a complete file and leaves its contents out of configuration errors', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-configuration-'));
  const file = path.join(folder, '.env');
  try {
    fs.writeFileSync(file, fs.readFileSync('.env.example'));
    expect(loadConfiguration(file).PG_PORT).toBe(example.PG_PORT);
    fs.writeFileSync(file, 'TOPOLOGY=single\nORDERING_PASSWORD=never-log-this\n');
    expect(() => loadConfiguration(file)).toThrow('missing PG_HOST');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('never-log-this');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
