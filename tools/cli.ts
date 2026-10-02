import { spawnSync } from 'node:child_process';
import { intro, outro, select, isCancel } from '@clack/prompts';
import { cfg } from '@lab/runtime';
import {
  startService,
  stopService,
  waitReady,
  status,
  names,
  type Service,
  type Action,
} from './operations';
const [name, service, arg] = process.argv.slice(2);
function monitor() {
  if (service === 'mbp19' || service === 'lab-vm') {
    if (!cfg.REMOTE_HOST || !cfg.REMOTE_USER)
      throw new Error('Configure the remote host and user in root .env');
    const host = cfg.REMOTE_USER + '@' + cfg.REMOTE_HOST;
    if (!/^[a-zA-Z0-9_.@-]+$/.test(host)) throw new Error('Invalid remote host');
    if (service === 'lab-vm' && !/^[a-zA-Z0-9_-]+$/.test(cfg.REMOTE_VM))
      throw new Error('Configure REMOTE_VM');
    const result = spawnSync(
      'ssh',
      ['-t', host, service === 'mbp19' ? 'btop' : 'limactl shell ' + cfg.REMOTE_VM + ' btop'],
      { stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  const result = spawnSync('bash', ['scripts/monitor'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
if (name === 'monitor') {
  process.exitCode = monitor();
} else if (name === 'test-browser') {
  await (await import('./browser-test')).runBrowserTests();
} else if (name === 'reload-operator') {
  await stopService('operator');
  await startService('operator');
  await waitReady(cfg.OPERATOR_URL);
  console.log('Operator reloaded; application processes retain their current state.');
} else if (name === 'operator') {
  await startService('operator');
  await waitReady(cfg.OPERATOR_URL);
  console.log(cfg.OPERATOR_URL);
} else if (name === 'feeder' || name === 'experiment') {
  const { request } = await import('@lab/client');
  const path = name === 'feeder' ? '/api/v1/feeder' : '/api/v1/experiments';
  const options =
    name === 'feeder'
      ? { shoppers: 30, concurrency: 4, seed: 42, thinkMs: 300 }
      : { scenario: service ?? 'cache-outage', durationSeconds: Number(arg ?? 12) };
  const method = service === 'status' ? 'GET' : 'POST';
  const route = service === 'stop' && name === 'feeder' ? path + '/stop' : path;
  console.log(
    JSON.stringify(
      await request(
        route,
        {
          method,
          ...(method === 'POST' && service !== 'stop' ? { body: JSON.stringify(options) } : {}),
        },
        cfg.OPERATOR_URL,
      ),
      null,
      2,
    ),
  );
} else if (name === 'status') console.log(JSON.stringify(await status(), null, 2));
else if (name) {
  await startService('operator');
  await waitReady(cfg.OPERATOR_URL);
  await requestAction(name, service as Service | undefined, arg);
} else {
  await startService('operator');
  await waitReady(cfg.OPERATOR_URL);
  intro('Systems lab · one operation at a time');
  while (true) {
    const choice = await select({
      message: 'What would you like to do?',
      options: [
        'start',
        'status',
        'monitor',
        'pause',
        'resume',
        'preset',
        'restart',
        'stop',
        'seed',
        'reset',
        'exit',
      ].map((value) => ({ value, label: value })),
    });
    if (isCancel(choice) || choice === 'exit') break;
    if (choice === 'status') {
      console.log(JSON.stringify(await status(), null, 2));
      continue;
    }
    if (choice === 'monitor') {
      monitor();
      continue;
    }
    let service: Service | undefined;
    let preset: string | undefined;
    if (choice === 'restart') {
      const v = await select({
        message: 'Which service?',
        options: names.map((value) => ({ value, label: value })),
      });
      if (isCancel(v)) continue;
      service = v;
    }
    if (choice === 'preset') {
      const v = await select({
        message: 'New fulfillment jobs use which preset?',
        options: ['success', 'slow', 'retry', 'fail'].map((value) => ({ value, label: value })),
      });
      if (isCancel(v)) continue;
      preset = v;
    }
    await requestAction(choice, service, preset);
  }
  outro('Lab processes remain in their requested state.');
}

async function requestAction(name: string, service?: Service, preset?: string) {
  const result = await fetch(cfg.OPERATOR_URL + '/api/v1/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, service, preset }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await result.json();
  if (!result.ok) {
    console.error(JSON.stringify(body, null, 2));
    process.exitCode = 1;
    return;
  }
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const response = await fetch(cfg.OPERATOR_URL + '/api/v1/actions/' + body.data.id, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error('Action status unavailable; inspect the original action before repeating it');
    const observed = (await response.json()).data as Action;
    if (observed.status === 'completed' || observed.status === 'failed') {
      console.log(JSON.stringify(observed, null, 2));
      if (observed.status === 'failed') process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Action still pending; inspect action ' + body.data.id + ' before repeating it');
}
