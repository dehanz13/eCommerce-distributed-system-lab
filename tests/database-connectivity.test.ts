import './runtime-fixture';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  clients: [] as Array<{
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    emit: (event: string, error: Error) => boolean;
  }>,
}));
vi.mock('pg', () => ({
  default: {
    Pool: class extends EventEmitter {
      async connect() {
        const client = Object.assign(new EventEmitter(), {
          query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          release: vi.fn(),
        });
        state.clients.push(client);
        this.emit('connect', client);
        return client;
      }
    },
  },
}));
const { pool, transaction, readActivity } = await import('@lab/runtime');

it('observes a disconnected checked-out connection without an unhandled error event', async () => {
  const p = pool('fulfillment');
  const client = await p.connect();
  expect(() => client.emit('error', new Error('fixture database interruption'))).not.toThrow();
  expect(readActivity('fulfillment')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'database.disconnected',
        message: 'fixture database interruption',
      }),
    ]),
  );
  client.release();
});

it('rejects interrupted work, attempts rollback, releases the connection and can accept later work', async () => {
  const p = pool('ordering');
  const failure = new Error('fixture connection lost');
  await expect(
    transaction(p, async (client) => {
      const fixture = state.clients.at(-1)!;
      fixture.query.mockRejectedValue(failure);
      client.emit('error', failure);
      await client.query('SELECT pending_work');
    }),
  ).rejects.toBe(failure);
  const failed = state.clients.at(-1)!;
  expect(failed.query.mock.calls.map(([sql]) => sql)).toEqual([
    'BEGIN',
    'SELECT pending_work',
    'ROLLBACK',
  ]);
  expect(failed.release).toHaveBeenCalledOnce();
  await expect(transaction(p, async () => 'reconnected')).resolves.toBe('reconnected');
  expect(state.clients.at(-1)!.release).toHaveBeenCalledOnce();
});
