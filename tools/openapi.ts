import fs from 'node:fs/promises';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import { cfg, root } from '@lab/runtime';
import { Event } from '@lab/contracts';
const target = path.join(root, 'docs/contracts');
await fs.mkdir(target, { recursive: true });
const formatting = await resolveConfig(path.join(root, '.prettierrc.json'));
for (const [owner, url] of Object.entries({
  ordering: cfg.ORDERING_URL,
  fulfillment: cfg.FULFILLMENT_URL,
  operator: cfg.OPERATOR_URL,
})) {
  const result = await fetch(url + '/openapi.json', { signal: AbortSignal.timeout(5000) });
  if (!result.ok) throw new Error('OpenAPI export unavailable: ' + owner);
  await fs.writeFile(
    path.join(target, owner + '.openapi.json'),
    await format(JSON.stringify(await result.json()), { ...formatting, parser: 'json' }),
  );
}
await fs.writeFile(
  path.join(target, 'events.schema.json'),
  await format(JSON.stringify(Event), { ...formatting, parser: 'json' }),
);
console.log('Exported live owner OpenAPI contracts and version-one event schema.');
