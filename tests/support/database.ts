import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';

/** Real owner migrations on an isolated PostgreSQL engine, not a SQL-string mock.
 * Single embedded connections cannot prove multi-connection locking; integration tests do.
 */
export async function database(owner: 'ordering' | 'fulfillment') {
  const db = new PGlite();
  const require = createRequire(import.meta.url);
  const folder = path.resolve('migrations', owner);
  for (const file of fs.readdirSync(folder).sort()) {
    const migration = require(path.join(folder, file)) as {
      up: (builder: { sql: (sql: string) => Promise<unknown> }) => Promise<unknown>;
    };
    await migration.up({ sql: (sql) => db.exec(sql) });
  }
  const query = async (sql: string, values?: unknown[]) => {
    const result = await db.query(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  const client = { query, release: () => {} };
  const pool = { query, connect: async () => client } as unknown as pg.Pool;
  return { db, pool };
}
