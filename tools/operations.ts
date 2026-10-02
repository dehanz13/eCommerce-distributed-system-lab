import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { root, cfg, activity } from '@lab/runtime';
const exec = promisify(execFile);
const state = path.join(root, '.lab');
fs.mkdirSync(state, { recursive: true });
export const names = [
  'web',
  'ordering',
  'fulfillment',
  'postgres',
  'rabbitmq',
  'redis',
  'toxiproxy',
] as const;
export type Service = (typeof names)[number];
export async function command(
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return exec(file, args, {
    cwd: options.cwd ?? root,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
    env: options.env ?? process.env,
  });
}
function remoteHost() {
  if (!cfg.REMOTE_HOST || !cfg.REMOTE_USER || !cfg.REMOTE_DIR)
    throw new Error('Configure REMOTE_HOST, REMOTE_USER and REMOTE_DIR in .env');
  if (!/^[a-zA-Z0-9_.@/-]+$/.test(cfg.REMOTE_DIR) || !cfg.REMOTE_DIR.startsWith('/'))
    throw new Error('REMOTE_DIR must be an absolute simple path');
  if (cfg.REMOTE_VM && !/^[a-zA-Z0-9_-]+$/.test(cfg.REMOTE_VM))
    throw new Error('Invalid REMOTE_VM');
  if (!/^[a-zA-Z0-9_.-]+$/.test(cfg.REMOTE_USER) || !/^[a-zA-Z0-9_.-]+$/.test(cfg.REMOTE_HOST))
    throw new Error('Invalid remote host or user');
  return `${cfg.REMOTE_USER}@${cfg.REMOTE_HOST}`;
}
const quote = (s: string) => "'" + s.replaceAll("'", "'\''") + "'";
async function compose(args: string[]) {
  if (cfg.TOPOLOGY === 'two') {
    return command('ssh', [
      remoteHost(),
      cfg.REMOTE_VM
        ? `limactl shell ${quote(cfg.REMOTE_VM)} sh -c ${quote(`cd ${quote(cfg.REMOTE_DIR)} && docker compose --env-file .lab/remote.env ${args.map(quote).join(' ')}`)}`
        : `cd ${quote(cfg.REMOTE_DIR)} && docker compose --env-file .lab/remote.env ${args.map(quote).join(' ')}`,
    ]);
  }
  return command('docker', ['compose', '--env-file', '.env', ...args]);
}
function pidFile(name: string) {
  return path.join(state, name + '.pid');
}
async function ownedPid(name: string) {
  try {
    const pid = Number(fs.readFileSync(pidFile(name), 'utf8'));
    process.kill(pid, 0);
    const info = await command('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    return info.stdout
      .split('\n')
      .some((line) => line === 'n' + root || line === 'n' + path.join(root, 'apps/web'))
      ? pid
      : null;
  } catch {
    return null;
  }
}
function servicePort(name: Service | 'operator') {
  return new URL(cfg[`${name.toUpperCase()}_URL` as 'WEB_URL']).port;
}
async function listeners(name: Service | 'operator') {
  try {
    const result = await command('lsof', ['-t', `-iTCP:${servicePort(name)}`, '-sTCP:LISTEN']);
    return [...new Set(result.stdout.trim().split(/\s+/).map(Number))].filter(
      (pid) => Number.isSafeInteger(pid) && pid > 0,
    );
  } catch (error) {
    // lsof exits 1 when nothing is listening. Other failures must remain visible.
    if ((error as { code?: number }).code === 1) return [];
    throw error;
  }
}
async function listenerBelongsHere(pid: number) {
  const info = await command('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  return info.stdout
    .split('\n')
    .some((line) => line === 'n' + root || line === 'n' + path.join(root, 'apps/web'));
}
export async function startService(name: Service | 'operator') {
  if (['postgres', 'rabbitmq', 'redis', 'toxiproxy'].includes(name)) {
    await compose(['up', '-d', '--wait', name]);
    return;
  }
  if (name === 'fulfillment' && cfg.TOPOLOGY === 'two') {
    await compose(['--profile', 'remote', 'up', '-d', '--build', 'fulfillment']);
    return;
  }
  const existing = await listeners(name);
  if (existing.length) {
    for (const pid of existing)
      if (!(await listenerBelongsHere(pid)))
        throw new Error(`${name} port ${servicePort(name)} belongs to another checkout`);
    return;
  }
  // A launcher may survive after its listener exits. Clean up that owned launcher.
  if (await ownedPid(name)) await stopService(name);
  if (name === 'web') {
    await command(
      process.execPath,
      [path.join(root, 'apps/web/node_modules/next/dist/bin/next'), 'build'],
      {
        cwd: path.join(root, 'apps/web'),
        env: {
          ...process.env,
          LAB_ORDERING_URL: cfg.ORDERING_URL,
          LAB_FULFILLMENT_URL: cfg.FULFILLMENT_URL,
          LAB_OPERATOR_URL: cfg.OPERATOR_URL,
        },
      },
    );
  }
  const out = fs.openSync(path.join(state, name + '.stdout.log'), 'a');
  const args =
    name === 'web'
      ? [
          path.join(root, 'apps/web/node_modules/next/dist/bin/next'),
          'start',
          '--hostname',
          '127.0.0.1',
          '--port',
          new URL(cfg.WEB_URL).port,
        ]
      : [
          '--import',
          path.join(root, 'node_modules/tsx/dist/loader.mjs'),
          path.join(root, `apps/${name}/src/main.ts`),
        ];
  const child = spawn(process.execPath, args, {
    cwd: name === 'web' ? path.join(root, 'apps/web') : root,
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      LAB_ORDERING_URL: cfg.ORDERING_URL,
      LAB_FULFILLMENT_URL: cfg.FULFILLMENT_URL,
      LAB_OPERATOR_URL: cfg.OPERATOR_URL,
    },
  });
  child.unref();
  fs.closeSync(out);
  fs.writeFileSync(pidFile(name), String(child.pid));
  let startupError: Error | undefined;
  child.on('error', (error) => (startupError = error));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`${name} exited before listening; inspect .lab/${name}.stdout.log`);
    // Readiness on an older process cannot certify this replacement's startup.
    if ((await listeners(name)).includes(child.pid!)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name} did not bind its port; inspect .lab/${name}.stdout.log`);
}
export async function stopService(name: Service | 'operator') {
  if (
    ['postgres', 'rabbitmq', 'redis', 'toxiproxy'].includes(name) ||
    (name === 'fulfillment' && cfg.TOPOLOGY === 'two')
  ) {
    await compose(['stop', '-t', '0', name]);
    return;
  }
  const activeListeners = await listeners(name);
  const ownedListeners: number[] = [];
  for (const listener of activeListeners) {
    if (!(await listenerBelongsHere(listener)))
      throw new Error(`Refusing to stop ${name}: its port belongs to another checkout`);
    ownedListeners.push(listener);
  }
  const pid = await ownedPid(name);
  if (pid) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  // Older tsx launches can leave a listener after their recorded parent has exited.
  for (const listener of ownedListeners) {
    try {
      process.kill(listener, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  const deadline = Date.now() + 3000;
  while ((await listeners(name)).length) {
    if (Date.now() >= deadline) throw new Error(`${name} listener has not stopped`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  fs.rmSync(pidFile(name), { force: true });
}
export async function waitReady(url: string, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const r = await fetch(url + '/health', {
        signal: AbortSignal.timeout(1500),
      });
      const body = await r.json();
      if (r.ok && body.data?.ready) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Readiness deadline exceeded: ${url}`);
}
export async function deployRemote() {
  const host = remoteHost();
  await command('ssh', [host, 'mkdir -p ' + quote(cfg.REMOTE_DIR)]);
  await command('rsync', [
    '-az',
    '--exclude=node_modules',
    '--exclude=.next',
    '--exclude=.lab',
    '--exclude=.env',
    '--exclude=.git',
    '--exclude=coverage',
    '--exclude=playwright-report',
    '--exclude=test-results',
    root + '/',
    `${host}:${cfg.REMOTE_DIR}/`,
  ]);
  const projection = {
    ...cfg,
    PG_HOST: 'postgres',
    PG_PORT: '5432',
    RABBIT_HOST: 'rabbitmq',
    RABBIT_PORT: '5672',
    RABBIT_CONNECT_HOST: 'toxiproxy',
    RABBIT_CONNECT_PORT: '8666',
    RABBIT_PROXY_PUBLISHED_PORT: cfg.RABBIT_CONNECT_PORT,
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    REDIS_PUBLISHED_PORT: cfg.REDIS_PORT,
    PG_PUBLISHED_PORT: cfg.PG_PORT,
    FULFILLMENT_PORT: new URL(cfg.FULFILLMENT_URL).port || '4312',
    RABBIT_PUBLISHED_PORT: cfg.RABBIT_PORT,
  };
  fs.writeFileSync(
    path.join(state, 'remote.env'),
    Object.entries(projection)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    { mode: 0o600 },
  );
  await command('ssh', [host, `mkdir -p ${quote(cfg.REMOTE_DIR + '/.lab')}`]);
  await command('scp', [
    path.join(state, 'remote.env'),
    `${host}:${cfg.REMOTE_DIR}/.lab/remote.env`,
  ]);
}
export async function startLab() {
  if (cfg.TOPOLOGY === 'two') await deployRemote();
  await compose(['up', '-d', '--wait', 'postgres', 'rabbitmq', 'redis', 'toxiproxy']);
  await command(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/migrate.ts']);
  await command(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/seed.ts']);
  await startService('ordering');
  await startService('fulfillment');
  await Promise.all([waitReady(cfg.ORDERING_URL), waitReady(cfg.FULFILLMENT_URL)]);
  await startService('web');
  await waitWeb();
}
async function waitWeb() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(cfg.WEB_URL, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Web readiness deadline exceeded');
}
export async function resetLab() {
  for (const n of ['web', 'ordering', 'fulfillment'] as const) await stopService(n);
  await compose(['--profile', 'remote', 'down', '-v']);
  for (const f of fs.readdirSync(state)) {
    if (f !== 'operator.pid' && f !== 'operator.stdout.log')
      fs.rmSync(path.join(state, f), { recursive: true, force: true });
  }
  await startLab();
}
export async function status() {
  const targets = {
    ordering: cfg.ORDERING_URL,
    fulfillment: cfg.FULFILLMENT_URL,
    operator: cfg.OPERATOR_URL,
    web: cfg.WEB_URL,
  };
  const values = await Promise.all(
    Object.entries(targets).map(async ([name, url]) => {
      try {
        const r = await fetch(url + (name === 'web' ? '' : '/health'), {
          signal: AbortSignal.timeout(2000),
        });
        const body = name === 'web' ? { data: { ready: r.ok } } : await r.json();
        return {
          name,
          reachable: true,
          ...body.data,
          requestedState: fs.existsSync(pidFile(name)) ? 'running' : 'unknown',
          observedAt: new Date().toISOString(),
        };
      } catch {
        return { name, reachable: false, ready: false, observedAt: new Date().toISOString() };
      }
    }),
  );
  return {
    topology: cfg.TOPOLOGY,
    services: values,
    webUrl: cfg.WEB_URL,
    observedAt: new Date().toISOString(),
  };
}
export const actionNames = [
  'start',
  'stop',
  'restart',
  'seed',
  'reset',
  'pause',
  'resume',
  'preset',
] as const;
export interface Action {
  id: string;
  name: string;
  service?: string;
  status: 'requested' | 'running' | 'completed' | 'failed';
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  progress: string;
}
export async function execute(name: string, service?: Service, preset?: string) {
  if (service && !names.includes(service)) throw new Error('Unknown named service');
  if (name === 'start') {
    if (service) await startService(service);
    else await startLab();
  } else if (name === 'stop') {
    if (service) await stopService(service);
    else for (const n of names) await stopService(n);
  } else if (name === 'restart') {
    if (!service) throw new Error('Select a named service');
    await stopService(service);
    await startService(service);
    if (service === 'ordering') await waitReady(cfg.ORDERING_URL);
    if (service === 'fulfillment') await waitReady(cfg.FULFILLMENT_URL);
    if (service === 'web') await waitWeb();
  } else if (name === 'seed')
    await command(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/seed.ts']);
  else if (name === 'reset') await resetLab();
  else if (['pause', 'resume', 'preset'].includes(name)) {
    const result = await fetch(cfg.FULFILLMENT_URL + '/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(name === 'preset' ? { preset } : { paused: name === 'pause' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) throw new Error('Fulfillment controls unavailable');
  } else throw new Error('Unknown action');
}
export function action(name: string, service?: Service): Action {
  return {
    id: randomUUID(),
    name,
    service,
    status: 'requested',
    requestedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    progress: 'Waiting to start',
  };
}
export function readActions(): Action[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(state, 'actions.json'), 'utf8'));
  } catch {
    return [];
  }
}
export function record(a: Action) {
  a.progress =
    a.status === 'requested'
      ? 'Waiting to start'
      : a.status === 'running'
        ? 'Executing named operation'
        : a.status === 'completed'
          ? 'Operation completed'
          : 'Inspect failure details';
  const history = readActions().filter((item) => item.id !== a.id);
  fs.writeFileSync(path.join(state, 'actions.json'), JSON.stringify([...history, a].slice(-100)));
  activity('operator', 'action.' + a.status, { ...a });
  fs.writeFileSync(path.join(state, 'last-action.json'), JSON.stringify(a));
}
