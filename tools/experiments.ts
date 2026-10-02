import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExperimentOptions, ExperimentRun } from '@lab/contracts';
import { cfg, root, activity, Problem } from '@lab/runtime';
import { status, startService, stopService, execute } from './operations';
const file = path.join(root, '.lab/experiment.json');
let current: ExperimentRun | null = null;
try {
  current = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (current?.status === 'running') {
    current.status = 'interrupted';
    current.restoration = 'unknown';
    current.error = 'Operator interrupted. Restore the lab before another exercise.';
    save();
  }
} catch {
  current = null;
}
function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(current), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export const explanations: Record<ExperimentOptions['scenario'], string> = {
  'cache-outage':
    'Catalog reads fall back to PostgreSQL. Checkout remains authoritative. Cache fills resume after Redis starts.',
  'broker-outage':
    'Accepted orders retain an outbox event. Publishers reconnect; jobs and outcomes resume without spending processing attempts on connectivity.',
  'database-outage':
    'Owner requests report dependency unavailable. Persisted work waits; no cache-only checkout is permitted.',
  'fulfillment-restart':
    'Immediate termination interrupts processing. Restart resumes persisted pending attempts without creating a second job.',
  'network-latency':
    'AMQP traffic receives 750 ms latency. HTTP remains direct; confirmations and asynchronous order outcomes take longer.',
  'network-cut':
    'Only the lab AMQP proxy is disconnected. HTTP and database remain available; outbox records wait for connectivity.',
  'slow-processing':
    'New jobs snapshot a five-second processing delay. Existing jobs retain their original preset.',
  'retry-processing':
    'New jobs fail once, wait one second, then succeed. Attempts and retry deadlines are persisted.',
  'failed-processing':
    'New jobs exhaust three processing attempts. Ordering marks failed and releases stock once.',
};
async function snapshot() {
  const read = async (url: string) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      return { status: r.status, ...(await r.json()) };
    } catch {
      return { unavailable: true };
    }
  };
  return {
    sampledAt: new Date().toISOString(),
    status: await status(),
    ordering: await read(cfg.ORDERING_URL + '/api/v1/system'),
    fulfillment: await read(cfg.FULFILLMENT_URL + '/api/v1/system'),
    cache: await read(cfg.ORDERING_URL + '/api/v1/cache'),
  };
}
async function proxy(path: string, method: string, body?: unknown) {
  const result = await fetch(cfg.TOXIPROXY_URL + '/proxies/lab-rabbitmq' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(3000),
  });
  if (!result.ok && !(method === 'DELETE' && result.status === 404))
    throw new Error('Lab network proxy unavailable: ' + result.status);
}
export const experiments = {
  busy: () => current?.status === 'running',
  inspect: () => current,
  async restore() {
    // Explicit recovery is also safe after an interrupted operator: only named lab targets.
    await proxy('', 'POST', { enabled: true });
    await proxy('/toxics/lab-latency', 'DELETE');
    for (const service of ['postgres', 'rabbitmq', 'redis', 'fulfillment'] as const)
      await startService(service);
    await execute('resume');
    await execute('preset', undefined, 'success');
    if (current) {
      current.restoration = 'completed';
      save();
    }
  },
  start(options: ExperimentOptions) {
    if (experiments.busy())
      throw new Problem(409, 'EXPERIMENT_RUNNING', 'Wait for the active exercise');
    if (current?.restoration === 'unknown' || current?.restoration === 'failed')
      throw new Problem(409, 'RESTORATION_REQUIRED', 'Restore the previous exercise first');
    const run: ExperimentRun = {
      id: randomUUID(),
      options,
      status: 'running',
      requestedAt: new Date().toISOString(),
      finishedAt: null,
      expected: explanations[options.scenario],
      progress: 'Capturing baseline',
      restoration: 'pending',
    };
    current = run;
    save();
    void perform(run);
    return run;
  },
};
async function perform(run: ExperimentRun) {
  let restore: (() => Promise<void>) | undefined;
  try {
    run.before = await snapshot();
    const baseline = run.before as Awaited<ReturnType<typeof snapshot>>;
    if (!baseline.status.services.filter((x) => x.name !== 'web').every((x) => x.ready))
      throw new Error('Start healthy owner services before running an exercise');
    const scenario = run.options.scenario;
    if (
      ['cache-outage', 'broker-outage', 'database-outage', 'fulfillment-restart'].includes(scenario)
    ) {
      const service =
        scenario === 'cache-outage'
          ? 'redis'
          : scenario === 'broker-outage'
            ? 'rabbitmq'
            : scenario === 'database-outage'
              ? 'postgres'
              : 'fulfillment';
      restore = () => startService(service);
      await stopService(service);
    } else if (scenario === 'network-cut') {
      restore = () => proxy('', 'POST', { enabled: true });
      await proxy('', 'POST', { enabled: false });
    } else if (scenario === 'network-latency') {
      restore = () => proxy('/toxics/lab-latency', 'DELETE');
      await proxy('/toxics', 'POST', {
        name: 'lab-latency',
        type: 'latency',
        stream: 'downstream',
        toxicity: 1,
        attributes: { latency: 750, jitter: 0 },
      });
    } else {
      const observed = baseline.fulfillment as { data?: { settings?: { preset?: string } } };
      const preset = observed.data?.settings?.preset ?? 'success';
      restore = () => execute('preset', undefined, preset);
      await execute(
        'preset',
        undefined,
        scenario === 'slow-processing'
          ? 'slow'
          : scenario === 'retry-processing'
            ? 'retry'
            : 'fail',
      );
    }
    run.progress = 'Fault active; send a demo checkout or shoppers now';
    save();
    activity('operator', 'experiment.engaged', { runId: run.id, scenario });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    run.during = await snapshot();
    save();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, run.options.durationSeconds * 1000 - 1500)),
    );
    run.progress = 'Active window ended';
  } catch (e) {
    run.error = String(e);
  } finally {
    run.progress = 'Restoring changed dependency or setting';
    save();
    try {
      if (restore) await restore();
      run.restoration = 'completed';
    } catch (e) {
      run.restoration = 'failed';
      run.error = String(e);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
    run.after = await snapshot();
    run.status = run.error ? 'failed' : 'completed';
    run.finishedAt = new Date().toISOString();
    run.progress = 'Inspect expected behavior against the recorded snapshots';
    save();
    activity('operator', 'experiment.finished', {
      runId: run.id,
      status: run.status,
      restoration: run.restoration,
    });
  }
}
