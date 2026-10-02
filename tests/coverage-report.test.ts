import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
const source = path.resolve('tools/coverage-badge.mjs');
const folders: string[] = [];
afterEach(() =>
  folders.splice(0).forEach((folder) => fs.rmSync(folder, { recursive: true, force: true })),
);
const businessFiles = [
  'apps/ordering/src/domain.ts',
  'apps/ordering/src/policies.ts',
  'apps/ordering/src/catalog-cache.ts',
  'apps/fulfillment/src/domain.ts',
  'apps/fulfillment/src/policies.ts',
  'apps/web/lib/architecture-flow.ts',
  'packages/contracts/src/index.ts',
  'packages/contracts/src/experiments.ts',
  'packages/client/src/index.ts',
  'tools/shopper-behavior.ts',
  'tools/feeder.ts',
  'tools/experiments.ts',
];
function fixture(covered: number, omit = false) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-report-')));
  folders.push(folder);
  const metric = (total: number, value: number) => ({
    total,
    covered: value,
    skipped: 0,
    pct: (value / total) * 100,
  });
  const entry = (total: number, value: number) =>
    Object.fromEntries(
      ['lines', 'statements', 'functions', 'branches'].map((name) => [name, metric(total, value)]),
    );
  const summary: Record<string, unknown> = { total: entry(2200, covered * 12) };
  for (const file of businessFiles.slice(omit ? 1 : 0))
    summary[path.join(folder, file)] = entry(100, covered);
  summary[path.join(folder, 'apps/operator/src/main.ts')] = entry(1000, 0);
  fs.mkdirSync(path.join(folder, 'coverage'));
  fs.writeFileSync(path.join(folder, 'coverage/coverage-summary.json'), JSON.stringify(summary));
  const result = spawnSync(process.execPath, [source], {
    cwd: folder,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: path.join(folder, 'summary.md') },
  });
  return { folder, result };
}
it('reports the business gate and untested overall/system code separately without publishing host paths', () => {
  const { folder, result } = fixture(99);
  expect(result.status).toBe(0);
  const contents = fs.readFileSync(path.join(folder, 'coverage/system-summary.json'), 'utf8');
  expect(contents).not.toContain(folder);
  const report = JSON.parse(contents);
  expect(report.business.lines).toMatchObject({ total: 1200, covered: 1188, pct: 99 });
  expect(report.overall.lines.pct).toBe(54);
  expect(report.systems['apps/operator'].lines.pct).toBe(0);
  expect(fs.readFileSync(path.join(folder, 'docs/badges/business-coverage.svg'), 'utf8')).toContain(
    '99.00%',
  );
  expect(fs.readFileSync(path.join(folder, 'docs/badges/unit-coverage.svg'), 'utf8')).toContain(
    '54.00%',
  );
  expect(fs.readFileSync(path.join(folder, 'summary.md'), 'utf8')).toContain(
    'Overall configured scope',
  );
});
it('fails a business result at 90% while still writing the report', () => {
  const { folder, result } = fixture(90);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('below the 91% gate');
  expect(fs.existsSync(path.join(folder, 'coverage/system-summary.json'))).toBe(true);
});
it('fails when a listed business module is absent from the collected scope', () => {
  const { result } = fixture(99, true);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Missing business coverage');
});
