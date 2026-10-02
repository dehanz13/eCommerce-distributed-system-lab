import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const version = spawnSync('trivy', ['--version'], { stdio: 'inherit' });
if (version.error || version.status !== 0) {
  console.error('[image audit] Install Trivy, then rerun pnpm security:images.');
  process.exit(1);
}
const references = new Set();
for (const file of ['compose.yaml', 'Dockerfile', 'infrastructure/Dockerfile.browser']) {
  const text = fs.readFileSync(file, 'utf8');
  const pattern = file === 'compose.yaml' ? /^\s+image:\s+(\S+)/gm : /^FROM\s+(\S+)/gm;
  for (const match of text.matchAll(pattern)) references.add(match[1]);
}
let failures = 0;
for (const reference of references) {
  if (!/@sha256:[a-f0-9]{64}$/.test(reference)) {
    console.error('[image audit] A container reference is missing a pinned digest.');
    failures++;
    continue;
  }
  const scan = spawnSync(
    'trivy',
    ['image', '--scanners', 'vuln', '--severity', 'HIGH,CRITICAL', '--exit-code', '1', reference],
    { stdio: 'inherit' },
  );
  if (scan.error || scan.status !== 0) failures++;
}
console.log(
  `[image audit] ${references.size} references checked; ${failures} scans returned findings or failed.`,
);
process.exitCode = failures ? 1 : 0;
