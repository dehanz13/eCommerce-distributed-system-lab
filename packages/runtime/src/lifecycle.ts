import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot } from './configuration';

/** Save retained local cleanup evidence supplied by runtime/operations; never store configuration or credentials.
 * Input: folder, kind, report, from caller-owned closers, shutdown signals or a prepared cleanup report.
 * Communicates with owned connections and private local report files.
 */
export function writeCleanupEvidence(folder: string, kind: string, report: { id: string }) {
  const reports = path.join(folder, '.lab/reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(
    path.join(reports, `${kind}-${report.id}.json`),
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 },
  );
}

/** Close caller-owned timers/connections in order; record each failure and continue without touching other processes.
 * Input: owner, named closers with optional bounded timeout overrides, report folder and default timeout from owner startup/shutdown.
 * Communicates with owned connections and private local report files.
 */
export async function closeResources(
  owner: string,
  resources: Array<{ name: string; close: () => unknown | Promise<unknown>; timeoutMs?: number }>,
  folder = projectRoot(),
  timeoutMs = 5000,
) {
  const results: Array<{ name: string; closed: boolean; diagnostic?: string }> = [];
  for (const resource of resources) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(resource.close),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timeout')), resource.timeoutMs ?? timeoutMs);
        }),
      ]);
      results.push({ name: resource.name, closed: true });
    } catch {
      results.push({
        name: resource.name,
        closed: false,
        diagnostic:
          'Close failed or timed out. Inspect this owner’s activity and connection state before restart.',
      });
    } finally {
      clearTimeout(timer);
    }
  }
  const report = {
    id: randomUUID(),
    owner,
    sampledAt: new Date().toISOString(),
    verified: results.every((result) => result.closed),
    resources: results,
    retained: ['Durable records, unresolved submissions and reports are retained.'],
    lessons: [
      'SIGINT/SIGTERM permit orderly cleanup; forced termination cannot run shutdown handlers.',
      'Closing connections releases process resources; it does not prove the host returned to an idle baseline.',
    ],
    recoverySteps: results.every((result) => result.closed)
      ? ['Restart this owner with its pnpm dev command when ready.']
      : [
          'Inspect failed resource names and owner activity; verify listeners and dependencies before restarting.',
        ],
  };
  writeCleanupEvidence(folder, 'shutdown', report);
  return report;
}

/** Handle terminal Ctrl+C or SIGTERM for this application only; callers supply their owned resource closers.
 * Input: owner, resources, from caller-owned closers, shutdown signals or a prepared cleanup report.
 * Communicates with owned connections and private local report files.
 */
export function installShutdown(owner: string, resources: Parameters<typeof closeResources>[1]) {
  let stopping = false;
  /** Close this process’s registered resources once and exit with its measured outcome.
   * Input: no arguments; uses its current owner state, from caller-owned closers, shutdown signals or a prepared cleanup report.
   * Communicates with owned connections and private local report files.
   */
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void closeResources(owner, resources)
      .then((report) => {
        console.error(
          `[shutdown] ${owner}: ${report.verified ? 'completed' : 'unverified'}; see .lab/reports/shutdown-${report.id}.json`,
        );
        process.exit(report.verified ? 0 : 1);
      })
      .catch(() => {
        console.error(
          `[shutdown] ${owner}: report could not be saved; inspect disk space and permissions.`,
        );
        process.exit(1);
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
