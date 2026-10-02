import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Return locations and categories only; a flagged value must not appear in diagnostics. */
export function inspectPublicFile(file: string, contents: string) {
  const issues: string[] = [];
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example'))
    issues.push('private configuration file');
  if (
    /(^|\/)(\.ssh|\.aws|\.lab|test-results|playwright-report)\//.test(file) ||
    /(?:^|\/)(id_rsa|id_ed25519)(?:\.|$)/.test(file) ||
    /\.(pem|key|p12|pfx|jks)$/.test(file)
  )
    issues.push('private key, credential directory or generated runtime data');
  const personalPath = /\/(?:Users|home)\/[a-zA-Z0-9_.-]+/;
  if (personalPath.test(contents)) issues.push('machine-specific home path');
  if (
    file !== 'pnpm-lock.yaml' &&
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/.test(contents)
  )
    issues.push('email address requiring review');
  if (/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/.test(contents))
    issues.push('private overlay-network address');
  if (file === 'README.md' || file.startsWith('docs/')) {
    if (/\b(?:codex|claude|ai|mbp19)\b/i.test(contents) || /mbp19/i.test(file))
      issues.push('documentation terminology outside the project scope');
  }
  return issues.map((category) => `${file}: ${category}`);
}

export function checkPublicContent() {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
  const issues = files.flatMap((file) =>
    fs.existsSync(file) ? inspectPublicFile(file, fs.readFileSync(file, 'utf8')) : [],
  );
  if (issues.length) {
    console.error('[publication] Review these files before committing:\n' + issues.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      `[publication] Checked ${files.filter((file) => fs.existsSync(file)).length} files; no configured content-policy matches.`,
    );
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) checkPublicContent();
