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
    /** Discard migration-library progress messages, including SQL, rather than logging them.
     * Accepts library-supplied diagnostics; sends nothing to other systems. The final completion message follows both migrations.
     */
    log: () => {},
  });
console.log('Both owner migrations applied');
