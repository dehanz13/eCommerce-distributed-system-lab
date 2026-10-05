import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectRoot } from '@lab/runtime/configuration';
import { cleanGenerated } from './generated-cleanup';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
const exec = promisify(execFile);

/** Refuse local cache deletion while any default lab application port is listening; callers must stop manually started apps first.
 * Input: no arguments; uses its current owner state, from default ports and application origins from local configuration.
 * Communicates with OS listener inspection and local generated-artifact cleanup.
 */
async function assertIdle() {
  const ports = new Set([4310, 4311, 4312, 4313]);
  const file = path.join(projectRoot(), '.env');
  if (fs.existsSync(file)) {
    const values = dotenv.parse(fs.readFileSync(file));
    for (const key of ['WEB_URL', 'ORDERING_URL', 'FULFILLMENT_URL', 'OPERATOR_URL']) {
      if (!values[key]) continue;
      const port = Number(new URL(values[key]).port);
      if (!port) throw new Error('Configured application port unavailable');
      ports.add(port);
    }
  }
  if (process.platform === 'darwin') {
    try {
      const result = await exec('lsof', [
        '-nP',
        '-iTCP:' + [...ports].join(','),
        '-sTCP:LISTEN',
        '-t',
      ]);
      if (result.stdout.trim()) throw new Error('Listeners remain');
    } catch (error) {
      if ((error as { code?: number }).code !== 1) throw error;
    }
  } else {
    for (const port of ports) {
      const result = await exec('ss', ['-H', '-ltn', `sport = :${port}`]);
      if (result.stdout.trim()) throw new Error('Listeners remain');
    }
  }
}
const report = await cleanGenerated(projectRoot(), assertIdle);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.verified ? 0 : 1;
