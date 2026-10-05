import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
/** Only executed assertion results become checked items; missing/skipped tests remain unchecked.
 * Input: result, root, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function inventory(result, root) {
  return (result.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test) => ({
      file: path.relative(root, file.name).replaceAll(path.sep, '/'),
      name: test.fullName ?? test.title,
      status: test.status,
      durationMs:
        test.duration ??
        (test.endTime != null && test.startTime != null
          ? Math.max(0, test.endTime - test.startTime)
          : null),
    })),
  );
}
const owners = {
  'activity-collection.test.ts': 'Operator observation collection',
  'checkout.test.ts': 'Ordering',
  'catalog-cache.test.ts': 'Ordering',
  'fulfillment.test.ts': 'Fulfillment',
  'operator-lifecycle.test.ts': 'Operator',
  'resources.test.ts': 'Operator',
  'experiments.test.ts': 'Operator',
  'monitor.test.ts': 'Operator host monitoring',
  'backend-flow-order.test.ts': 'Operator replay ordering',
  'feeder.test.ts': 'Shopper feeder',
  'shopper-behavior.test.ts': 'Shopper feeder',
  'architecture-flow.test.ts': 'Web',
  'client.test.ts': 'Client wrapper',
  'http-contract.test.ts': 'Shared contracts and runtime',
  'observation.test.ts': 'Shared runtime',
  'configuration.test.ts': 'Configuration',
  'domain.test.ts': 'Ordering, Fulfillment and event contracts',
  'coverage-report.test.ts': 'Quality tooling',
  'test-inventory.test.ts': 'Quality tooling',
  'public-content.test.ts': 'Publication tooling',
};
/** Write the current measured test inventory from the saved runner result.
 * Input: input, from CLI/control input, public owner contracts or measured local evidence.
 * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
 */
export async function writeInventory(input = '.lab/unit-results.json') {
  const root = await fs.realpath('.');
  const result = JSON.parse(await fs.readFile(input, 'utf8'));
  const tests = inventory(result, root);
  const formatting = await resolveConfig('.prettierrc.json');
  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: 'Vitest JSON assertion results',
    runStartedAt: new Date(result.startTime).toISOString(),
    counts: {
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed').length,
      skippedOrPending: tests.filter((t) => !['passed', 'failed'].includes(t.status)).length,
    },
    tests,
  };
  await fs.writeFile(
    'docs/test-inventory.json',
    await format(JSON.stringify(snapshot), { ...formatting, parser: 'json' }),
  );
  let markdown = `# Unit and module test inventory\n\nGenerated ${snapshot.generatedAt} from the run started ${snapshot.runStartedAt}. Source: ${snapshot.source}. Passed ${snapshot.counts.passed}; failed ${snapshot.counts.failed}; skipped/pending ${snapshot.counts.skippedOrPending}.\n\nRegenerate with \`pnpm test\` or \`pnpm test:coverage\`. A checked box means this test passed in that run. Unchecked items carry their actual status; they do not imply every unexecuted test failed. Integration/browser checks have separate commands and do not appear in this unit inventory. Collection failures are listed separately. This is a dated snapshot, not a live indicator.\n\nTests use good and rejected fictional inputs at public boundaries. Pure policies use literal expected values. SQL tests apply the real migrations to an in-memory PostgreSQL engine; locking across real connections is covered separately. HTTP/process mocks represent external boundaries and do not establish live-service readiness. See [testing standards](runtime-observation.md#test-evidence).\n`;
  for (const file of [...new Set(tests.map((t) => t.file))].sort()) {
    markdown += `\n## ${owners[path.basename(file)] ?? 'Shared tooling'} · ${file}\n\n`;
    for (const test of tests.filter((t) => t.file === file))
      markdown += `- [${test.status === 'passed' ? 'x' : ' '}] ${String(test.name).replace(/[\r\n]/g, ' ')} — **${test.status}**${test.durationMs == null ? '' : ` (${Math.round(test.durationMs)} ms)`}\n`;
  }
  const failures = (result.testResults ?? []).filter(
    (file) =>
      file.status === 'failed' &&
      !(file.assertionResults ?? []).some((test) => test.status === 'failed'),
  );
  if (failures.length)
    markdown +=
      '\n## Collection failures\n\n' +
      failures
        .map((file) => `- [ ] ${path.relative(root, file.name)} — **collection failed**\n`)
        .join('');
  await fs.writeFile(
    'docs/test-inventory.md',
    await format(markdown, { ...formatting, parser: 'markdown' }),
  );
  console.log(
    `[test inventory] ${tests.length} executed/collected cases; ${snapshot.counts.failed} failed.`,
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await writeInventory(process.argv[2]);
