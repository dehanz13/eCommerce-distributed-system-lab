import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeCleanupEvidence } from '@lab/runtime/lifecycle';

/** Count bytes under an allowlisted generated path using filesystem metadata; never follow symlinks outside the checkout.
 * Input: target, from the explicit generated-artifact allowlist.
 * Communicates with local filesystem metadata only; no network or dependency controls.
 */
function bytes(target: string): number {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs
    .readdirSync(target)
    .reduce((total, child) => total + bytes(path.join(target, child)), 0);
}

/** Remove only rebuildable local artifacts after the caller proves local apps idle; retain data, recovery state and reports.
 * Input: folder, assertIdle, from caller-selected checkout and an idle-state verifier.
 * Communicates with allowlisted local filesystem artifacts and private cleanup reports.
 */
export async function cleanGenerated(folder: string, assertIdle: () => Promise<void>) {
  const paths = [
    'apps/web/.next',
    'coverage',
    'test-results',
    'playwright-report',
    '.lab/browser.env',
  ];
  const results: Array<{ path: string; beforeBytes: number | null; removed: boolean }> = [];
  const errors: string[] = [];
  try {
    await assertIdle();
  } catch {
    errors.push(
      'Local application state is active or unavailable. Stop local applications and verify their listeners before cleanup.',
    );
  }
  if (!errors.length) {
    for (const relative of paths) {
      let beforeBytes: number | null = null;
      try {
        const target = path.join(folder, relative);
        // Intermediate symlinks can redirect deletion outside the checkout; reject them before inspecting the artifact.
        let parent = folder;
        for (const part of relative.split('/').slice(0, -1)) {
          parent = path.join(parent, part);
          if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink())
            throw new Error('Symlinked ancestor');
        }
        beforeBytes = bytes(target);
        fs.rmSync(target, { recursive: true, force: true });
        results.push({ path: relative, beforeBytes, removed: !fs.existsSync(target) });
        if (fs.existsSync(target))
          errors.push(`Artifact remains at ${relative}; verify its users before retrying.`);
      } catch {
        results.push({ path: relative, beforeBytes, removed: false });
        errors.push(
          `Could not remove ${relative}; inspect permissions and active users of that artifact.`,
        );
      }
    }
  }
  const report = {
    id: randomUUID(),
    action: 'clean-generated',
    sampledAt: new Date().toISOString(),
    verified: !errors.length && results.every((result) => result.removed),
    results,
    errors,
    retained: [
      'Source, configuration, node_modules, database/broker volumes, unresolved submissions, activity logs and cleanup reports.',
    ],
    lessons: [
      'Removing build/test caches frees disk space, not proof of reclaimed host memory.',
      'Rebuild the web app and regenerate test evidence before using removed artifacts.',
    ],
    recoverySteps: errors.length
      ? ['Inspect the listed errors; stop local apps before repeating this command.']
      : ['Use pnpm build or pnpm dev:web to recreate the web build.'],
  };
  writeCleanupEvidence(folder, 'generated', report);
  return report;
}
