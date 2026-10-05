import { expect, it, vi } from 'vitest';
const read = vi.hoisted(() => vi.fn());
vi.mock('@lab/runtime/observation', () => ({
  readActivity: read,
  safeObservation: (value: unknown) => value,
}));

it('bounds repeated viewer failures and reports recovery without changing service state', async () => {
  const args = process.argv;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const once = vi.spyOn(process, 'once').mockReturnValue(process);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  process.argv = ['node', 'logs', 'all'];
  read.mockImplementation(() => {
    throw new Error('private failure details');
  });
  try {
    vi.resetModules();
    await import('../tools/logs');
    expect(
      errors.mock.calls.filter((call) => String(call[0]).includes('unavailable')),
    ).toHaveLength(1);
    vi.advanceTimersByTime(29500);
    expect(
      errors.mock.calls.filter((call) => String(call[0]).includes('unavailable')),
    ).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(errors.mock.calls.at(-1)?.[1]).toEqual({ suppressedFailures: 59 });
    read.mockReturnValue([]);
    vi.advanceTimersByTime(2000);
    expect(errors.mock.calls.filter((call) => String(call[0]).includes('recovered'))).toHaveLength(
      1,
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain('private failure details');
  } finally {
    process.argv = args;
    vi.clearAllTimers();
    vi.useRealTimers();
    errors.mockRestore();
    once.mockRestore();
  }
});

it('retains quiet-owner IDs through busy-owner bursts and retires IDs outside the snapshot', async () => {
  const args = process.argv;
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const once = vi.spyOn(process, 'once').mockReturnValue(process);
  vi.useFakeTimers();
  process.argv = ['node', 'logs', 'all'];
  const quiet = { id: 'quiet', owner: 'fulfillment', occurredAt: new Date(0).toISOString() };
  let batch = 0;
  let retained = true;
  read.mockImplementation((owner: string) =>
    owner === 'fulfillment'
      ? retained
        ? [quiet]
        : []
      : owner === 'ordering'
        ? Array.from({ length: 200 }, (_, index) => ({
            id: `ordering-${batch}-${index}`,
            owner,
            occurredAt: new Date(batch * 200 + index + 1).toISOString(),
          }))
        : [],
  );
  try {
    vi.resetModules();
    await import('../tools/logs');
    for (batch = 1; batch <= 8; batch++) vi.advanceTimersByTime(500);
    expect(
      output.mock.calls.filter(([line]) => JSON.parse(String(line)).id === quiet.id),
    ).toHaveLength(1);
    retained = false;
    vi.advanceTimersByTime(500);
    retained = true;
    vi.advanceTimersByTime(500);
    expect(
      output.mock.calls.filter(([line]) => JSON.parse(String(line)).id === quiet.id),
    ).toHaveLength(2);
  } finally {
    process.argv = args;
    vi.clearAllTimers();
    vi.useRealTimers();
    output.mockRestore();
    errors.mockRestore();
    once.mockRestore();
  }
});
