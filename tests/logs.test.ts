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
