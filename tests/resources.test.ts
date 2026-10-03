import { expect, it } from 'vitest';
import { cleanupReport, type ResourceSnapshot } from '../tools/resources';
const host = (scope: string, freeMemoryBytes = 100): ResourceSnapshot => ({
  scope,
  source: 'fixture boundary',
  sampledAt: '2026-10-02T00:00:00.000Z',
  available: true,
  totalMemoryBytes: 1000,
  freeMemoryBytes,
  diskFreeBytes: 2000,
  loadAverage: [0, 0, 0],
  managedResidentBytes: 0,
  error: null,
});
it('reports measured changes and retained allocations without claiming baseline restoration', () => {
  const report = cleanupReport(
    'stop',
    [host('local', 100)],
    [host('local', 300)],
    [
      { name: 'ordering', running: false },
      { name: 'postgres', running: false },
    ],
    [],
  );
  expect(report.verified).toBe(true);
  expect(report.hosts[0]?.freeMemoryDeltaBytes).toBe(200);
  expect(report.retained).toContain('Operator stays running for control and recovery.');
  expect(report.baselineRestored).toBe(null);
});
it('fails verification for a remaining service or unavailable measurement', () => {
  const missing = {
    ...host('guest'),
    available: false,
    freeMemoryBytes: null,
    error: 'SSH unavailable',
  };
  const report = cleanupReport(
    'stop',
    [host('guest')],
    [missing],
    [{ name: 'fulfillment', running: true }],
    ['stop failed'],
  );
  expect(report.verified).toBe(false);
  expect(report.hosts[0]?.freeMemoryDeltaBytes).toBe(null);
  expect(report.errors).toEqual(['stop failed']);
});
