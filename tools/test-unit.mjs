import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { writeInventory } from './test-inventory.mjs';
fs.mkdirSync('.lab', { recursive: true });
fs.rmSync('.lab/unit-results.json', { force: true });
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--reporter=default',
    '--reporter=json',
    '--outputFile.json=.lab/unit-results.json',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
if (fs.existsSync('.lab/unit-results.json')) await writeInventory();
else
  console.error(
    '[test inventory] No fresh result file was produced; previous documentation is stale.',
  );
process.exitCode = result.status ?? 1;
