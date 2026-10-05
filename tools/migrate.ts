import { runner } from 'node-pg-migrate';
import { cfg, root } from '@lab/runtime';
import path from 'node:path';
for (const owner of ['ORDERING', 'FULFILLMENT'] as const)
  await runner({
    databaseUrl: {
      host: cfg.PG_HOST,
      port: +cfg.PG_PORT,
      user: cfg[`${owner}_USER`],
      password: cfg[`${owner}_PASSWORD`],
      database: cfg[`${owner}_DB`],
    },
    dir: path.join(root, 'migrations', owner.toLowerCase()),
    direction: 'up',
    migrationsTable: 'migrations',
    count: Infinity,
    /** Record this request’s bounded diagnostic stage when tracing is enabled.
     * Input: no arguments; uses its current owner state, from CLI/control input, public owner contracts or measured local evidence.
     * Communicates with named lab operations, owner HTTP and scoped filesystem/process adapters.
     */
    log: () => {},
  });
console.log('Both owner migrations applied');
