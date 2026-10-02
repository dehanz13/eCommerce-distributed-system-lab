import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cfg, root } from '@lab/runtime';
async function docker(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Docker browser check failed with exit code ' + code)),
    );
  });
}
export async function runBrowserTests() {
  const web = new URL(cfg.WEB_URL);
  if (['localhost', '127.0.0.1', '[::1]'].includes(web.hostname))
    web.hostname = 'host.docker.internal';
  const target = path.join(root, '.lab/browser.env');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.writeFileSync(
    target,
    Object.entries({ ...cfg, WEB_URL: web.toString().replace(/\/$/, '') })
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n'),
    { mode: 0o600 },
  );
  await docker([
    'build',
    '-f',
    'infrastructure/Dockerfile.browser',
    '-t',
    'learning-core-browser:local',
    '.',
  ]);
  await docker([
    'run',
    '--rm',
    '--memory=1g',
    '--cpus=2',
    '--shm-size=256m',
    ...(process.platform === 'linux' ? ['--add-host=host.docker.internal:host-gateway'] : []),
    '-v',
    target + ':/app/.env:ro',
    '-v',
    path.join(root, 'test-results') + ':/app/test-results',
    'learning-core-browser:local',
  ]);
}
