import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const requiredKeys = [
  'TOPOLOGY',
  'PG_HOST',
  'PG_PORT',
  'PG_ADMIN_USER',
  'PG_ADMIN_PASSWORD',
  'ORDERING_DB',
  'ORDERING_USER',
  'ORDERING_PASSWORD',
  'FULFILLMENT_DB',
  'FULFILLMENT_USER',
  'FULFILLMENT_PASSWORD',
  'RABBIT_HOST',
  'RABBIT_PORT',
  'RABBIT_CONNECT_PORT',
  'RABBIT_MANAGEMENT_PORT',
  'RABBIT_USER',
  'RABBIT_PASSWORD',
  'REDIS_HOST',
  'REDIS_PORT',
  'ORDERING_URL',
  'FULFILLMENT_URL',
  'OPERATOR_URL',
  'WEB_URL',
  'TOXIPROXY_URL',
] as const;
const optionalDefaults = {
  RABBIT_CONNECT_HOST: '',
  REMOTE_HOST: '',
  REMOTE_USER: '',
  REMOTE_DIR: '',
  REMOTE_VM: '',
  REMOTE_BIND_IP: '',
};
export type Configuration = Record<(typeof requiredKeys)[number], string> & typeof optionalDefaults;

/** Locate the repository root from the current working directory.
 * Input: no arguments; uses its current owner state, from local configuration files or caller-supplied settings.
 * Communicates with local filesystem only; no dependency startup.
 */
export function projectRoot() {
  let folder = process.cwd();
  while (!fs.existsSync(path.join(folder, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(folder);
    if (parent === folder) throw new Error('Run within the lab repository');
    folder = parent;
  }
  return folder;
}

/** Explain invalid configuration by field names without displaying supplied values.
 * Input: issues, source, from local configuration files or caller-supplied settings.
 * Communicates with local filesystem only; no dependency startup.
 */
function rejectConfiguration(issues: string[], source: string): never {
  // Only names and fixes belong in diagnostics; never interpolate supplied values.
  const message = `[configuration] ${source}: ${issues.join('; ')}. Check the root .env against .env.example.`;
  console.error(message);
  throw new Error(message);
}

/** Validate the editable source before any process or dependency is started.
 * Input: input, source, from local configuration files or caller-supplied settings.
 * Communicates with local filesystem only; no dependency startup.
 */
export function validateConfiguration(
  input: Record<string, string>,
  source = '.env',
): Configuration {
  const issues: string[] = [];
  for (const key of requiredKeys) if (!input[key]?.trim()) issues.push(`missing ${key}`);
  const values = { ...optionalDefaults, ...input } as Configuration;
  if (input.TOPOLOGY && !['single', 'two'].includes(input.TOPOLOGY))
    issues.push('TOPOLOGY must be single or two');
  for (const key of [
    'PG_PORT',
    'RABBIT_PORT',
    'RABBIT_CONNECT_PORT',
    'RABBIT_MANAGEMENT_PORT',
    'REDIS_PORT',
  ] as const) {
    const value = input[key];
    if (value?.trim() && (!/^\d+$/.test(value) || +value < 1 || +value > 65535))
      issues.push(`${key} must be an integer between 1 and 65535`);
  }
  for (const key of [
    'ORDERING_URL',
    'FULFILLMENT_URL',
    'OPERATOR_URL',
    'WEB_URL',
    'TOXIPROXY_URL',
  ] as const) {
    if (!input[key]?.trim()) continue;
    try {
      const url = new URL(input[key]);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      ) {
        issues.push(`${key} must be an HTTP origin without credentials, a path, query or fragment`);
      } else if (key !== 'TOXIPROXY_URL' && (!url.port || Number(url.port) < 1)) {
        // Lifecycle commands consume URL.port; parsing removes HTTP/HTTPS default ports.
        issues.push(`${key} must include a non-default listening port between 1 and 65535`);
      }
    } catch {
      issues.push(`${key} must be an HTTP origin`);
    }
  }
  if (values.TOPOLOGY === 'two')
    for (const key of ['REMOTE_HOST', 'REMOTE_USER', 'REMOTE_DIR'] as const)
      if (!values[key]?.trim()) issues.push(`missing ${key} for two-machine mode`);
  if (issues.length) rejectConfiguration(issues, source);
  return values;
}

/** Require the named settings needed by a scoped operation.
 * Input: values, keys, from local configuration files or caller-supplied settings.
 * Communicates with local filesystem only; no dependency startup.
 */
export function requireSettings(values: Configuration, keys: (keyof Configuration)[]) {
  const missing = keys.filter((key) => !values[key]?.trim());
  if (missing.length)
    rejectConfiguration(
      missing.map((key) => `missing ${key}`),
      '.env',
    );
}

/** Read and validate the backend/operator configuration file.
 * Input: file, from local configuration files or caller-supplied settings.
 * Communicates with local filesystem only; no dependency startup.
 */
export function loadConfiguration(file = path.join(projectRoot(), '.env')) {
  let contents: string;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    rejectConfiguration(['configuration file is missing or unreadable'], '.env');
  }
  return validateConfiguration(dotenv.parse(contents), '.env');
}

/** Read only public HTTP origins from .env.web (or .env); the web process never needs API credentials.
 * Input: folder, from the web entry point and local public-origin file.
 * Communicates with local filesystem only; no dependency startup.
 */
export function loadWebConfiguration(folder = projectRoot()) {
  const dedicated = path.join(folder, '.env.web');
  const file = fs.existsSync(dedicated) ? dedicated : path.join(folder, '.env');
  const input = dotenv.parse(fs.readFileSync(file, 'utf8'));
  const values: Record<string, string> = {};
  for (const key of ['ORDERING_URL', 'FULFILLMENT_URL', 'OPERATOR_URL'] as const) {
    try {
      const url = new URL(input[key] ?? '');
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error('Invalid origin');
      values[key] = url.origin;
    } catch {
      throw new Error(
        `[configuration] ${key} must be an HTTP origin in .env.web or .env; values omitted.`,
      );
    }
  }
  return values as Record<'ORDERING_URL' | 'FULFILLMENT_URL' | 'OPERATOR_URL', string>;
}
