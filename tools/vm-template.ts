import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { cfg, root } from '@lab/runtime';
import { requireSettings } from '@lab/runtime/configuration';
requireSettings(cfg, ['REMOTE_USER', 'REMOTE_DIR', 'REMOTE_BIND_IP']);
if (
  !/^[a-zA-Z0-9_-]+$/.test(cfg.REMOTE_USER) ||
  !/^[a-zA-Z0-9_./-]+$/.test(cfg.REMOTE_DIR) ||
  !cfg.REMOTE_DIR.startsWith('/') ||
  !isIP(cfg.REMOTE_BIND_IP)
)
  throw new Error('Set REMOTE_USER, absolute REMOTE_DIR, and REMOTE_BIND_IP in root .env');
const source = fs.readFileSync(
  path.join(root, 'infrastructure/ecommerce-lab.lima.yaml.template'),
  'utf8',
);
const projected = source
  .replaceAll('__REMOTE_USER__', cfg.REMOTE_USER)
  .replaceAll('__REMOTE_DIR__', cfg.REMOTE_DIR)
  .replaceAll('__REMOTE_BIND_IP__', cfg.REMOTE_BIND_IP);
fs.mkdirSync(path.join(root, '.lab'), { recursive: true });
fs.writeFileSync(path.join(root, '.lab/ecommerce-lab.yaml'), projected, { mode: 0o600 });
console.log(
  'Generated .lab/ecommerce-lab.yaml from root .env. VM creation remains an explicit host operation.',
);
