import { registerInspectionRoutes } from './inspection-routes';
import { Type } from '@sinclair/typebox';
import {
  Id,
  ActionInput,
  FeederInput,
  ExperimentInput,
  type FeederOptions,
  type ExperimentOptions,
} from '@lab/contracts';
import { cfg, server, listen, response, Problem, root } from '@lab/runtime';
import {
  action,
  execute,
  record,
  readActions,
  status,
  readCleanup,
  type Action,
  type Service,
} from '../../../tools/operations';
import { feeder } from '../../../tools/feeder';
import { experiments, explanations } from '../../../tools/experiments';
import { installShutdown } from '@lab/runtime/lifecycle';
const app = await server('operator');
const actions = new Map<string, Action>();
for (const a of readActions()) {
  if (a.status === 'running' || a.status === 'requested') {
    a.status = 'failed';
    a.finishedAt = new Date().toISOString();
    a.error =
      'Operator restarted before completion was observed; inspect state before requesting another action';
    record(a);
  }
  actions.set(a.id, a);
}
let busy = false;
let activeAction: Promise<void> | undefined;
registerInspectionRoutes(app);
app.get('/health', (req) => response(req, { ready: true }));
app.get('/api/v1/resources', (req) => response(req, readCleanup()));
app.get('/api/v1/status', (req) => status().then((x) => response(req, x)));
app.post(
  '/api/v1/actions',
  {
    schema: {
      body: ActionInput,
    },
  },
  async (req, reply) => {
    if (busy || experiments.busy() || feeder.busy())
      throw new Problem(409, 'ACTION_IN_PROGRESS', 'Wait for the current control action');
    const b = req.body as { name: string; service?: Service; preset?: string };
    const previousCleanupId = readCleanup()?.id;
    const a = action(b.name, b.service);
    actions.set(a.id, a);
    if (actions.size > 100) actions.delete(actions.keys().next().value!);
    busy = true;
    record(a);
    // Own accepted work immediately, including its delay, so HTTP 202 cannot outlive shutdown tracking.
    activeAction = new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => {
      a.status = 'running';
      a.startedAt = new Date().toISOString();
      record(a);
      return execute(b.name, b.service, b.preset, (progress) => {
        a.progress = progress;
        record(a);
      })
        .then((cleanup) => {
          if (cleanup) a.cleanup = cleanup;
          if (b.name === 'reset')
            for (const key of actions.keys()) if (key !== a.id) actions.delete(key);
          a.status = 'completed';
        })
        .catch((e) => {
          a.status = 'failed';
          a.error = e instanceof Error ? e.message : 'Action failed; inspect operator activity';
          const cleanup = readCleanup();
          if (cleanup && cleanup.id !== previousCleanupId) a.cleanup = cleanup;
        })
        .finally(() => {
          a.finishedAt = new Date().toISOString();
          busy = false;
          record(a);
        });
    });
    // A failed state write must be observed without an unhandled rejection; shutdown still receives that failure.
    void activeAction.catch(() => {
      console.error('[actions] Action state could not be saved; inspect .lab state permissions.');
    });
    reply.code(202);
    return response(req, a);
  },
);
app.get('/api/v1/actions', (req) => response(req, [...actions.values()].reverse()));
app.get('/api/v1/actions/:id', { schema: { params: Type.Object({ id: Id }) } }, (req) => {
  const a = actions.get((req.params as { id: string }).id);
  if (!a) throw new Problem(404, 'ACTION_NOT_FOUND', 'Action is no longer retained');
  return response(req, a);
});
app.get('/api/v1/broker', async (req) => {
  const result = await fetch(`http://${cfg.RABBIT_HOST}:${cfg.RABBIT_MANAGEMENT_PORT}/api/queues`, {
    headers: {
      Authorization:
        'Basic ' + Buffer.from(cfg.RABBIT_USER + ':' + cfg.RABBIT_PASSWORD).toString('base64'),
    },
    signal: AbortSignal.timeout(2000),
  });
  if (!result.ok) throw new Problem(503, 'BROKER_UNAVAILABLE', 'Broker management is unavailable');
  const queues = (await result.json()) as Array<Record<string, unknown>>;
  return response(
    req,
    queues
      .filter((x) => String(x.name).startsWith('lab.'))
      .map((x) => ({
        name: x.name,
        messages: x.messages,
        ready: x.messages_ready,
        unacknowledged: x.messages_unacknowledged,
        consumers: x.consumers,
        sampledAt: new Date().toISOString(),
      })),
  );
});
app.get('/api/v1/host', async (req) => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const disk = fs.statfsSync(root);
  return response(req, {
    scope: 'operator host',
    platform: os.platform(),
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg(),
    memoryTotal: os.totalmem(),
    memoryFree: os.freemem(),
    diskFree: disk.bavail * disk.bsize,
    sampledAt: new Date().toISOString(),
  });
});
app.get('/api/v1/feeder', (req) => response(req, feeder.inspect()));
app.post('/api/v1/feeder', { schema: { body: FeederInput } }, (req, reply) => {
  if (busy) throw new Problem(409, 'ACTION_IN_PROGRESS', 'Wait for the lifecycle action');
  reply.code(202);
  return response(req, feeder.start(req.body as FeederOptions));
});
app.post('/api/v1/feeder/stop', (req) => response(req, feeder.stop()));
app.post(
  '/api/v1/feeder/recover/:id',
  { schema: { params: Type.Object({ id: Id }) } },
  async (req) => {
    if (busy || experiments.busy() || feeder.busy())
      throw new Problem(
        409,
        'ACTION_IN_PROGRESS',
        'Finish active work before recovering a checkout',
      );
    busy = true;
    try {
      return response(req, await feeder.recover((req.params as { id: string }).id));
    } finally {
      busy = false;
    }
  },
);
app.get('/api/v1/experiments', (req) =>
  response(req, { scenarios: explanations, run: experiments.inspect() }),
);
app.post('/api/v1/experiments', { schema: { body: ExperimentInput } }, (req, reply) => {
  if (busy || feeder.busy())
    throw new Problem(
      409,
      'ACTION_IN_PROGRESS',
      'Start an exercise before starting shopper traffic',
    );
  reply.code(202);
  return response(req, experiments.start(req.body as ExperimentOptions));
});
app.post('/api/v1/experiments/restore', async (req) => {
  if (busy || experiments.busy() || feeder.busy())
    throw new Problem(409, 'ACTION_IN_PROGRESS', 'Wait for active work before restoration');
  busy = true;
  try {
    await experiments.restore();
    return response(req, { restoredAt: new Date().toISOString() });
  } finally {
    busy = false;
  }
});
await listen(app, cfg.OPERATOR_URL);
installShutdown('operator', [
  {
    name: 'HTTP listener and active requests',
    /** Drain requests and close this owner HTTP server; receives no data and uses the server created at startup. */
    close: () => app.close(),
  },
  {
    name: 'accepted lifecycle action and retained result',
    // Named commands can take 120 seconds each; multi-step actions have a finite shutdown budget.
    timeoutMs: 180000,
    /** Drain the action accepted by this operator, including its start delay and named service work.
     * Receives no data; uses the promise retained by /api/v1/actions and its persisted completion record.
     * Communicates through the action's existing named process adapters; no additional operation is started.
     */
    close: async () => {
      await activeAction;
    },
  },
  {
    name: 'new shopper scheduling (retained work survives restart)',
    /** Stop scheduling new simulated shoppers during shutdown; accepts no input, uses the startup feeder, and retains existing recovery records. */
    close: () => {
      feeder.stop();
    },
  },
  {
    name: 'active failure exercise restoration and retained report',
    // Named dependency operations can take up to 120 seconds; allow bounded restoration before exit.
    timeoutMs: 180000,
    /** Drain the startup-owned exercise task; accepts no data and awaits its named dependency restoration and evidence. */
    close: () => experiments.close(),
  },
]);
