import { randomUUID } from 'node:crypto';
import type { CleanupReport, ResourceSnapshot } from '@lab/contracts';
export type { ResourceSnapshot } from '@lab/contracts';
/** Compare observed snapshots only; an unknown baseline is never reported as restored. */
export function cleanupReport(
  action: string,
  before: ResourceSnapshot[],
  after: ResourceSnapshot[],
  services: CleanupReport['services'],
  errors: string[],
): CleanupReport {
  return {
    id: randomUUID(),
    action,
    sampledAt: new Date().toISOString(),
    verified:
      errors.length === 0 &&
      services.every((x) => x.running === false) &&
      after.every((x) => x.available),
    baselineRestored: null,
    hosts: after.map((sample) => {
      const previous = before.find((x) => x.scope === sample.scope) ?? null;
      return {
        scope: sample.scope,
        before: previous,
        after: sample,
        freeMemoryDeltaBytes:
          sample.freeMemoryBytes !== null && previous?.freeMemoryBytes != null
            ? sample.freeMemoryBytes - previous.freeMemoryBytes
            : null,
      };
    }),
    services,
    errors,
    retained: [
      'Operator stays running for control and recovery.',
      'Database volumes, images, build caches and retained logs stay on disk.',
      'Free-memory changes include operating-system caches and unrelated workloads; no idle baseline has been certified.',
    ],
  };
}
