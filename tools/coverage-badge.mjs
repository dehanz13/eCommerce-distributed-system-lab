import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
// Report the full configured unit-test scope, including files no test touched.
const summary = JSON.parse(await readFile('coverage/coverage-summary.json', 'utf8'));
const pct = summary.total.lines.pct;
if (typeof pct !== 'number' || !Number.isFinite(pct))
  throw new Error('Missing measured line coverage');
const color = pct >= 80 ? '#4c1' : pct >= 60 ? '#dfb317' : '#e05d44';
const label = `${pct.toFixed(2)}%`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="20" role="img" aria-label="unit coverage: ${label}"><title>unit coverage: ${label}</title><rect width="96" height="20" fill="#555"/><rect x="96" width="64" height="20" fill="${color}"/><g fill="#fff" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11"><text x="48" y="14">unit coverage</text><text x="128" y="14">${label}</text></g></svg>
`;
await mkdir('docs/badges', { recursive: true });
await writeFile('docs/badges/unit-coverage.svg', svg);
await writeFile(
  'coverage/badge.json',
  JSON.stringify({ schemaVersion: 1, label: 'unit coverage', message: label, color }, null, 2),
);
const metrics = ['lines', 'statements', 'functions', 'branches']
  .map((name) => `| ${name} | ${summary.total[name].pct}% |`)
  .join('\n');
const report = `### Measured unit coverage\n\n| Metric | Coverage |\n| --- | --- |\n${metrics}\n\nScope includes untested application and tool files. Integration/browser guarantees are verified separately.\n`;
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
