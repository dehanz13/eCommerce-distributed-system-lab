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

export function projectRoot() {
  let folder = process.cwd();
  while (!fs.existsSync(path.join(folder, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(folder);
    if (parent === folder) throw new Error('Run within the lab repository');
    folder = parent;
  }
  return folder;
}

function rejectConfiguration(issues: string[], source: string): never {
  // Only names and fixes belong in diagnostics; never interpolate supplied values.
  const message = `[configuration] ${source}: ${issues.join('; ')}. Check the root .env against .env.example.`;
  console.error(message);
  throw new Error(message);
}

/** Validate the editable source before any process or dependency is started. */
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
      )
        issues.push(`${key} must be an HTTP origin without credentials, a path, query or fragment`);
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

export function requireSettings(values: Configuration, keys: (keyof Configuration)[]) {
  const missing = keys.filter((key) => !values[key]?.trim());
  if (missing.length)
    rejectConfiguration(
      missing.map((key) => `missing ${key}`),
      '.env',
    );
}

export function loadConfiguration(file = path.join(projectRoot(), '.env')) {
  let contents: string;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    rejectConfiguration(['configuration file is missing or unreadable'], '.env');
  }
  return validateConfiguration(dotenv.parse(contents), '.env');
}
