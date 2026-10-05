import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { activity, server, response, Problem, readActivity, loop } from '@lab/runtime';
const app = await server('observation-test');
app.post('/api/v1/observations', (req) => response(req, req.body));
app.post('/api/v1/checkouts', () => {
  throw new Problem(409, 'EMPTY_CART', 'Add an item');
});
app.get('/health', (req) => response(req, { ready: true }));
afterAll(() => app.close());
it('records an authoritative process stream and sequence when timestamps tie', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  try {
    activity('sequence-fixture', 'fixture.first', { streamId: 'caller-value', sequence: 0 });
    activity('sequence-fixture', 'fixture.second', { streamId: 'caller-value', sequence: 0 });
    const [second, first] = readActivity('sequence-fixture');
    expect(second?.occurredAt).toBe(first?.occurredAt);
    expect(first?.streamId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(second?.streamId).toBe(first?.streamId);
    expect(Number(first?.sequence)).toBeGreaterThan(0);
    expect(Number(second?.sequence)).toBeGreaterThan(Number(first?.sequence));
  } finally {
    vi.useRealTimers();
  }
});
it('records input, processing and output with one trace and redacts nested credentials', async () => {
  const correlationId = randomUUID();
  await app.inject({
    method: 'POST',
    url: '/api/v1/observations',
    headers: { 'x-correlation-id': correlationId },
    payload: { name: 'start', password: 'do-not-log', nested: { authorization: 'private-value' } },
  });
  const logs = readActivity('observation-test', correlationId);
  expect(logs.map((x) => x.stage)).toEqual(expect.arrayContaining(['input', 'process', 'output']));
  expect(JSON.stringify(logs)).not.toContain('do-not-log');
  expect(JSON.stringify(logs)).not.toContain('private-value');
  expect(logs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'http.completed',
        output: expect.objectContaining({
          data: expect.objectContaining({ name: 'start', password: '[redacted]' }),
        }),
      }),
    ]),
  );
});
it('logs rejected business submissions and keeps successful health polling quiet', async () => {
  const correlationId = randomUUID();
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/checkouts',
    headers: { 'x-correlation-id': correlationId },
    payload: {},
  });
  expect(result.statusCode).toBe(409);
  expect(readActivity('observation-test', correlationId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'operation.failed', code: 'EMPTY_CART', stage: 'output' }),
    ]),
  );
  const pollingId = randomUUID();
  await app.inject({ url: '/health', headers: { 'x-correlation-id': pollingId } });
  expect(readActivity('observation-test', pollingId)).toEqual([]);
});

it('bounds payloads and preserves a successful response if the activity sink fails', async () => {
  const correlationId = randomUUID();
  activity('observation-test', 'fixture.input', {
    correlationId,
    stage: 'input',
    input: { entries: Array.from({ length: 101 }, (_, n) => n), text: 'a'.repeat(9000) },
  });
  const input = readActivity('observation-test', correlationId)[0]?.input as {
    entries: unknown[];
    text: string;
  };
  expect(input.entries.at(-1)).toEqual({ truncatedItems: 1 });
  expect(input.text.endsWith('[truncated]')).toBe(true);
  const append = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
    throw new Error('disk full');
  });
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/observations',
      payload: { name: 'start' },
    });
    expect(result.statusCode).toBe(200);
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('check disk space'));
  } finally {
    append.mockRestore();
    diagnostic.mockRestore();
  }
});
it('summarizes identical dependency failures and records recovery without idle success logs', async () => {
  vi.useFakeTimers();
  let failing = true;
  const cancel = loop(
    'loop-fixture',
    async () => {
      if (failing) throw new Error('dependency offline');
    },
    100,
  );
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      readActivity('loop-fixture').filter((x) => x.type === 'dependency.waiting'),
    ).toHaveLength(1);
    failing = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      readActivity('loop-fixture').filter((x) => x.type === 'dependency.recovered'),
    ).toHaveLength(1);
    expect(
      readActivity('loop-fixture').find((x) => x.type === 'dependency.recovered')?.suppressed,
    ).toBe(9);
  } finally {
    cancel();
    vi.useRealTimers();
  }
});

it('does not let a polling header suppress business write observations', async () => {
  const id = randomUUID();
  await app.inject({
    method: 'POST',
    url: '/api/v1/observations',
    headers: { 'x-lab-observation': 'poll', 'x-correlation-id': id },
    payload: { name: 'start' },
  });
  expect(readActivity('observation-test', id).some((x) => x.stage === 'output')).toBe(true);
});
