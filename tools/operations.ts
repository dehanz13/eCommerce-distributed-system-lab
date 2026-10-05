import { quoteShell } from './shell';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { CleanupReport, ResourceSnapshot } from '@lab/contracts';
import { cleanupReport } from './resources';
import { writeCleanupEvidence } from '@lab/runtime/lifecycle';
import { root, cfg, activity } from '@lab/runtime';
import { requireSettings } from '@lab/runtime/configuration';
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
/** Execute a literal allowlisted process command with bounded captured output.
 * Input: file, args, options, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
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
/** Validate the configured SSH target before a remote lab operation.
 * Input: no arguments; uses its current owner state, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
function remoteHost() {
  requireSettings(cfg, ['REMOTE_HOST', 'REMOTE_USER', 'REMOTE_DIR']);
  if (!/^[a-zA-Z0-9_.@/-]+$/.test(cfg.REMOTE_DIR) || !cfg.REMOTE_DIR.startsWith('/'))
    throw new Error('REMOTE_DIR must be an absolute simple path');
  if (cfg.REMOTE_VM && !/^[a-zA-Z0-9_-]+$/.test(cfg.REMOTE_VM))
    throw new Error('Invalid REMOTE_VM');
  if (!/^[a-zA-Z0-9_.-]+$/.test(cfg.REMOTE_USER) || !/^[a-zA-Z0-9_.-]+$/.test(cfg.REMOTE_HOST))
    throw new Error('Invalid remote host or user');
  return `${cfg.REMOTE_USER}@${cfg.REMOTE_HOST}`;
}
/** Run scoped lab Compose commands on the selected local/remote container host.
 * Input: args, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
async function compose(args: string[]) {
  if (cfg.TOPOLOGY === 'two') {
    return command('ssh', [
      remoteHost(),
      cfg.REMOTE_VM
        ? `limactl shell ${quoteShell(cfg.REMOTE_VM)} sh -c ${quoteShell(`cd ${quoteShell(cfg.REMOTE_DIR)} && docker compose --env-file .lab/remote.env ${args.map(quoteShell).join(' ')}`)}`
        : `cd ${quoteShell(cfg.REMOTE_DIR)} && docker compose --env-file .lab/remote.env ${args.map(quoteShell).join(' ')}`,
    ]);
  }
  return command('docker', ['compose', '--env-file', '.env', ...args]);
}
/** Locate the recorded launcher PID file for a named lab process.
 * Input: name, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
function pidFile(name: string) {
  return path.join(state, name + '.pid');
}
/** Check whether a recorded lab launcher still exists.
 * Input: name, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
async function ownedPid(name: string) {
  try {
    const pid = Number(fs.readFileSync(pidFile(name), 'utf8'));
    process.kill(pid, 0);
    return (await listenerBelongsHere(pid)) ? pid : null;
  } catch {
    return null;
  }
}
/** Read the named owner’s configured listening port.
 * Input: name, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
function servicePort(name: Service | 'operator') {
  return new URL(cfg[`${name.toUpperCase()}_URL` as 'WEB_URL']).port;
}
/** Inspect listening process IDs on a configured application port.
 * Input: name, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
async function listeners(name: Service | 'operator') {
  if (process.platform === 'linux') {
    // Older Linux lsof skips Next's truncated process name with unmatched parentheses.
    const deadline = Date.now() + 500;
    while (true) {
      const result = await command('ss', ['-H', '-ltnp', `sport = :${servicePort(name)}`]);
      const rows = result.stdout.trim().split('\n').filter(Boolean);
      const owners = rows.map((row) =>
        [...row.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])),
      );
      if (owners.every((pids) => pids.length)) return [...new Set(owners.flat())];
      // After SIGKILL the kernel can briefly expose a socket whose owner has exited.
      if (Date.now() >= deadline)
        throw new Error(`${name} listener ownership is unavailable; refusing lifecycle changes`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
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
/** Verify a listener’s checkout ownership before lifecycle changes.
 * Input: pid, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
async function listenerBelongsHere(pid: number) {
  if (process.platform === 'linux') {
    const info = await command('readlink', [`/proc/${pid}/cwd`]);
    const cwd = info.stdout.trim();
    return cwd === root || cwd === path.join(root, 'apps/web');
  }
  const info = await command('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  return info.stdout
    .split('\n')
    .some((line) => line === 'n' + root || line === 'n' + path.join(root, 'apps/web'));
}
/** Start only the requested lab process/container and verify its listener.
 * Input: name, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
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
/** Stop only the requested owned process/container and verify release.
 * Input: name, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
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
/** Wait for a named owner’s explicit readiness response.
 * Input: url, timeout, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
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
/** Project and transfer only the lab configuration/artifacts needed by the selected remote host.
 * Input: no arguments; uses its current owner state, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export async function deployRemote() {
  const host = remoteHost();
  await command('ssh', [host, 'mkdir -p ' + quoteShell(cfg.REMOTE_DIR)]);
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
  await command('ssh', [host, `mkdir -p ${quoteShell(cfg.REMOTE_DIR + '/.lab')}`]);
  await command('scp', [
    path.join(state, 'remote.env'),
    `${host}:${cfg.REMOTE_DIR}/.lab/remote.env`,
  ]);
}
/** Start the existing managed topology, migrate/seed and verify owner readiness.
 * Input: progress, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export async function startLab(progress: (message: string) => void = () => {}) {
  if (cfg.TOPOLOGY === 'two') {
    if (cfg.REMOTE_VM)
      await command('ssh', [remoteHost(), `limactl start ${quoteShell(cfg.REMOTE_VM)}`]);
    await deployRemote();
  }
  progress('Starting PostgreSQL, RabbitMQ, Redis and proxy');
  await compose(['up', '-d', '--wait', 'postgres', 'rabbitmq', 'redis', 'toxiproxy']);
  progress('Applying owner migrations and fictional seed');
  await command(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/migrate.ts']);
  await command(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/seed.ts']);
  progress('Starting ordering and fulfillment; checking dependencies');
  await startService('ordering');
  await startService('fulfillment');
  await Promise.all([waitReady(cfg.ORDERING_URL), waitReady(cfg.FULFILLMENT_URL)]);
  progress('Building and starting web; checking HTTP readiness');
  await startService('web');
  await waitWeb();
}
/** Verify that the configured web HTTP process responds.
 * Input: no arguments; uses its current owner state, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
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
/** Explicitly erase only lab-owned disposable data and recreate it.
 * Input: no arguments; uses its current owner state, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export async function resetLab() {
  for (const n of ['web', 'ordering', 'fulfillment'] as const) await stopService(n);
  await compose(['--profile', 'remote', 'down', '-v']);
  for (const f of fs.readdirSync(state)) {
    if (f !== 'operator.pid' && f !== 'operator.stdout.log')
      fs.rmSync(path.join(state, f), { recursive: true, force: true });
  }
  await startLab();
}
/** Return currently observed readiness or delivery connectivity.
 * Input: no arguments; uses its current owner state, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
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
    operatorUrl: cfg.OPERATOR_URL,
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
  'poweroff',
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
  cleanup?: CleanupReport;
}
/** Dispatch one allowlisted lifecycle action and preserve cleanup evidence.
 * Input: name, service, preset, progress, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export async function execute(
  name: string,
  service?: Service,
  preset?: string,
  progress: (message: string) => void = () => {},
): Promise<CleanupReport | undefined> {
  progress(`${name} ${service ?? 'lab'} requested`);
  if (service && !names.includes(service)) throw new Error('Unknown named service');
  if (name === 'start') {
    if (service) await startService(service);
    else {
      try {
        await startLab(progress);
      } catch (error) {
        try {
          await stopLab('startup rollback', false, progress);
        } catch {
          throw new Error(
            'Startup failed and cleanup is unverified; inspect owner logs and /api/v1/resources.',
          );
        }
        throw error;
      }
    }
  } else if (name === 'stop') {
    if (service) return stopNamedService(service);
    else return stopLab('stop', false, progress);
  } else if (name === 'restart') {
    if (!service) {
      const cleanup = await stopLab('restart', false, progress);
      await execute('start', undefined, undefined, progress);
      return cleanup;
    }
    await stopService(service);
    await startService(service);
    if (service === 'ordering') await waitReady(cfg.ORDERING_URL);
    if (service === 'fulfillment') await waitReady(cfg.FULFILLMENT_URL);
    if (service === 'web') await waitWeb();
  } else if (name === 'poweroff') {
    if (service) throw new Error('Poweroff applies to the whole lab');
    return stopLab('poweroff', true, progress);
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
/** Create a recorded operator action with its requested time.
 * Input: name, service, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
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
/** Read bounded persisted operator action history.
 * Input: no arguments; uses its current owner state, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export function readActions(): Action[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(state, 'actions.json'), 'utf8'));
  } catch {
    return [];
  }
}
/** Persist the updated operator action and its outcome.
 * Input: a, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export function record(a: Action) {
  a.progress =
    a.status === 'requested'
      ? 'Waiting to start'
      : a.status === 'running'
        ? a.progress === 'Waiting to start'
          ? 'Executing named operation'
          : a.progress
        : a.status === 'completed'
          ? 'Operation completed'
          : 'Inspect failure details';
  const history = readActions().filter((item) => item.id !== a.id);
  atomicState('actions.json', [...history, a].slice(-100));
  activity('operator', 'action.' + a.status, { ...a, actionId: a.id });
  atomicState('last-action.json', a);
}

/** Replace one lab state file atomically.
 * Input: file, value, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
function atomicState(file: string, value: unknown) {
  const temporary = path.join(state, file + '.tmp');
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, path.join(state, file));
}
/** Read the last measured cleanup report without claiming it is current.
 * Input: no arguments; uses its current owner state, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export function readCleanup(): CleanupReport | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(state, 'cleanup.json'), 'utf8'));
  } catch {
    return null;
  }
}
const remoteSample = `import os,json,platform,subprocess,re,shutil
if platform.system()=='Linux':
 m=dict((a,int(b)*1024) for a,b in re.findall(r'^(MemTotal|MemAvailable):\\s+(\\d+)',open('/proc/meminfo').read(),re.M))
 total=m['MemTotal'];free=m['MemAvailable']
else:
 total=int(subprocess.check_output(['sysctl','-n','hw.memsize']))
 v=subprocess.check_output(['vm_stat'],text=True)
 page=int(re.search(r'page size of (\\d+)',v).group(1))
 free=sum(int(re.search(r'^'+re.escape(k)+r':\\s+(\\d+)',v,re.M).group(1)) for k in ['Pages free','Pages inactive'])*page
print(json.dumps(dict(totalMemoryBytes=total,freeMemoryBytes=free,diskFreeBytes=shutil.disk_usage('.').free,loadAverage=list(os.getloadavg()),managedResidentBytes=None)))`;
/** Represent an unavailable resource sample without inventing measurements.
 * Input: scope, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
function unavailable(scope: string): ResourceSnapshot {
  return {
    scope,
    source: 'unavailable host probe',
    sampledAt: new Date().toISOString(),
    available: false,
    totalMemoryBytes: null,
    freeMemoryBytes: null,
    diskFreeBytes: null,
    loadAverage: null,
    managedResidentBytes: null,
    error: 'Host sample unavailable; verify connectivity and Python 3 on the selected host.',
  };
}
/** Measure each reachable configured host/guest using explicit probe sources.
 * Input: includeGuest, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export async function sampleResources(includeGuest = true): Promise<ResourceSnapshot[]> {
  const disk = fs.statfsSync(root);
  let resident: number | null = null;
  try {
    const pids = (
      await Promise.all(
        (['web', 'ordering', 'fulfillment'] as const)
          .filter((x) => !(x === 'fulfillment' && cfg.TOPOLOGY === 'two'))
          .map(listeners),
      )
    ).flat();
    const owned = [];
    for (const pid of pids) if (await listenerBelongsHere(pid)) owned.push(pid);
    resident = owned.length
      ? (await command('ps', ['-o', 'rss=', '-p', owned.join(',')])).stdout
          .trim()
          .split(/\s+/)
          .reduce((n, x) => n + Number(x) * 1024, 0)
      : 0;
    if (!Number.isFinite(resident)) resident = null;
  } catch {
    /* A missing process measurement is unavailable, never zero. */
  }
  const samples: ResourceSnapshot[] = [
    {
      scope: 'operator host',
      source: 'Node os + statfs + owned-process ps RSS (OS free memory)',
      sampledAt: new Date().toISOString(),
      available: true,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      diskFreeBytes: disk.bavail * disk.bsize,
      loadAverage: os.loadavg(),
      managedResidentBytes: resident,
      error: null,
    },
  ];
  if (cfg.TOPOLOGY === 'two') {
    for (const scope of ['remote host', ...(cfg.REMOTE_VM && includeGuest ? ['lab guest'] : [])]) {
      try {
        const script = `python3 -c ${quoteShell(remoteSample)}`;
        const result = await command('ssh', [
          remoteHost(),
          scope === 'lab guest'
            ? `limactl shell ${quoteShell(cfg.REMOTE_VM)} sh -c ${quoteShell(script)}`
            : script,
        ]);
        const observed = JSON.parse(result.stdout);
        if (
          ![observed.totalMemoryBytes, observed.freeMemoryBytes, observed.diskFreeBytes].every(
            (x) => typeof x === 'number' && Number.isFinite(x),
          )
        )
          throw new Error('Invalid host measurement');
        samples.push({
          scope,
          source: 'SSH Python 3 + OS counters (Linux available or macOS free + inactive memory)',
          sampledAt: new Date().toISOString(),
          available: true,
          ...observed,
          error: null,
        });
      } catch {
        samples.push(unavailable(scope));
      }
    }
  }
  return samples;
}
/** Attempt all independent owned cleanup steps, verify remaining state and save evidence.
 * Input: reason, releaseVm, progress, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export async function stopLab(
  reason = 'stop',
  releaseVm = false,
  progress: (message: string) => void = () => {},
): Promise<CleanupReport> {
  progress('Sampling host resources before teardown');
  const before = await sampleResources();
  const errors: string[] = [];
  // Continue across independent failures so one unreachable service cannot skip local cleanup.
  for (const name of [
    'web',
    'ordering',
    ...(cfg.TOPOLOGY === 'two' ? [] : ['fulfillment']),
  ] as Service[]) {
    try {
      progress(`Stopping owned ${name} process`);
      activity('operator', 'cleanup.step', { service: name, step: 'stop owned process' });
      await stopService(name);
    } catch {
      errors.push(`Could not stop ${name}; inspect listener ownership and terminal permissions.`);
    }
  }
  try {
    progress('Removing lab containers and networks; preserving volumes');
    await compose(['--profile', 'remote', 'down', '--remove-orphans', '-t', '0']);
  } catch {
    errors.push('Compose teardown failed; inspect the configured container host.');
  }
  let vmReleased = false;
  if (releaseVm && cfg.TOPOLOGY === 'two' && cfg.REMOTE_VM) {
    try {
      progress('Stopping configured dedicated guest');
      await command('ssh', [remoteHost(), `limactl stop ${quoteShell(cfg.REMOTE_VM)}`]);
      vmReleased = true;
    } catch {
      errors.push('Configured lab guest did not stop; inspect its status.');
    }
  }
  progress('Verifying listeners, container state and resource samples');
  const services: CleanupReport['services'] = [];
  for (const name of [
    'web',
    'ordering',
    ...(cfg.TOPOLOGY === 'two' ? [] : ['fulfillment']),
  ] as Service[]) {
    try {
      services.push({ name, running: (await listeners(name)).length > 0 });
    } catch {
      services.push({ name, running: null, error: 'Listener probe unavailable' });
    }
  }
  try {
    const result = vmReleased
      ? { stdout: '' }
      : await compose(['--profile', 'remote', 'ps', '--status', 'running', '--services']);
    const running = new Set(result.stdout.trim().split(/\s+/).filter(Boolean));
    for (const name of [
      'postgres',
      'rabbitmq',
      'redis',
      'toxiproxy',
      ...(cfg.TOPOLOGY === 'two' ? ['fulfillment'] : []),
    ])
      services.push({ name, running: running.has(name) });
    for (const name of running)
      if (!services.some((x) => x.name === name)) services.push({ name, running: true });
  } catch {
    for (const name of [
      'postgres',
      'rabbitmq',
      'redis',
      'toxiproxy',
      ...(cfg.TOPOLOGY === 'two' ? ['fulfillment'] : []),
    ])
      services.push({ name, running: null, error: 'Container probe unavailable' });
  }
  const after = (await sampleResources()).filter((x) => !(vmReleased && x.scope === 'lab guest'));
  const report = cleanupReport(reason, before, after, services, errors);
  if (cfg.TOPOLOGY === 'two' && cfg.REMOTE_VM)
    report.retained.push(
      vmReleased
        ? 'Configured lab guest is stopped; its virtual disk remains on disk.'
        : 'Configured lab guest remains allocated. Use poweroff to release its CPU and memory allocation.',
    );
  atomicState('cleanup.json', report);
  writeCleanupEvidence(root, 'cleanup', report);
  activity('operator', 'cleanup.completed', {
    cleanupId: report.id,
    verified: report.verified,
    services: report.services,
    errors,
  });
  if (!report.verified)
    throw new Error('Cleanup could not be verified. Inspect /api/v1/resources before restarting.');
  return report;
}

/** Stop one operator-selected owner/dependency and record its measured release without stopping independent systems.
 * Inputs come from a validated named control action; communicates with OS listeners, scoped Compose and host probes.
 */
async function stopNamedService(service: Service): Promise<CleanupReport> {
  const before = await sampleResources();
  const errors: string[] = [];
  try {
    await stopService(service);
  } catch {
    errors.push(`Could not stop ${service}; inspect its owner logs and scoped controls.`);
  }
  const services: CleanupReport['services'] = [];
  try {
    const container =
      ['postgres', 'rabbitmq', 'redis', 'toxiproxy'].includes(service) ||
      (service === 'fulfillment' && cfg.TOPOLOGY === 'two');
    const running = container
      ? (await compose(['--profile', 'remote', 'ps', '--status', 'running', '--services'])).stdout
          .trim()
          .split(/\s+/)
          .includes(service)
      : (await listeners(service)).length > 0;
    services.push({ name: service, running });
  } catch {
    services.push({ name: service, running: null, error: 'Stop probe unavailable' });
  }
  const report = cleanupReport(
    `stop ${service}`,
    before,
    await sampleResources(),
    services,
    errors,
  );
  atomicState('cleanup.json', report);
  writeCleanupEvidence(root, 'cleanup', report);
  if (!report.verified)
    throw new Error(`Cleanup of ${service} could not be verified. Inspect /api/v1/resources.`);
  return report;
}
