import { Type } from '@sinclair/typebox';
import { Id, Preset } from '@lab/contracts';
import { cfg, pool, server, listen, response, loop, Problem } from '@lab/runtime';
import { row } from '@lab/runtime/rows';
import { broker } from '@lab/runtime/broker';
import { fulfillment } from './domain';
const p = pool('fulfillment');
const app = await server('fulfillment');
let connected = () => false;
const domain = fulfillment(p, () => connected());
const io = broker('fulfillment', p, domain.consume);
connected = () => io.status().connected;
loop('fulfillment', io.tick);
loop('fulfillment', domain.tick, 100);
app.get('/health', async (req, reply) => {
  let db = true;
  try {
    await p.query('SELECT 1');
  } catch {
    db = false;
  }
  reply.code(db ? 200 : 503);
  return response(req, {
    database: db,
    broker: io.status().connected,
    ready: db && io.status().connected,
  });
});
app.get('/api/v1/system', async (req) => {
  const settings = await p.query('SELECT * FROM settings');
  const jobs = await p.query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100');
  const attempts = await p.query('SELECT * FROM attempts ORDER BY started_at DESC LIMIT 100');
  const states = await p.query(
    'SELECT status,count(*)::integer AS count FROM jobs GROUP BY status',
  );
  const outbox = await p.query('SELECT * FROM outbox ORDER BY created_at DESC LIMIT 50');
  const pending = await p.query(
    'SELECT count(*)::integer AS count,min(created_at) AS oldest_pending_at FROM outbox WHERE published_at IS NULL',
  );
  const db = await p.query(
    'SELECT numbackends,xact_commit,xact_rollback,deadlocks FROM pg_stat_database WHERE datname=current_database()',
  );
  return response(req, {
    settings: row(settings.rows[0]),
    jobs: jobs.rows.map(row),
    attempts: attempts.rows.map(row),
    states: states.rows,
    outbox: outbox.rows.map(row),
    pending: row(pending.rows[0]),
    database: db.rows[0],
    broker: io.status(),
  });
});
app.get('/api/v1/jobs/:id', { schema: { params: Type.Object({ id: Id }) } }, async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await p.query('SELECT * FROM jobs WHERE id=$1', [id]);
  if (!job.rows[0]) throw new Problem(404, 'JOB_NOT_FOUND', 'Job does not exist');
  const attempts = await p.query('SELECT * FROM attempts WHERE job_id=$1 ORDER BY attempt_number', [
    id,
  ]);
  return response(req, {
    ...row<Record<string, unknown>>(job.rows[0]),
    attempts: attempts.rows.map(row),
  });
});
app.put(
  '/api/v1/settings',
  {
    schema: {
      body: Type.Object(
        { preset: Type.Optional(Preset), paused: Type.Optional(Type.Boolean()) },
        { additionalProperties: false },
      ),
    },
  },
  async (req) => {
    const b = req.body as { preset?: string; paused?: boolean };
    const result = await p.query(
      'UPDATE settings SET preset=COALESCE($1,preset),paused=COALESCE($2,paused),updated_at=now() WHERE id=1 RETURNING *',
      [b.preset, b.paused],
    );
    return response(req, row(result.rows[0]));
  },
);
await listen(app, cfg.FULFILLMENT_URL);
