import { randomUUID } from 'node:crypto';
import type { CleanupReport, ResourceSnapshot } from '@lab/contracts';
export type { ResourceSnapshot } from '@lab/contracts';
/** Compare observed snapshots only; an unknown baseline is never reported as restored.
 * Input: action, before, after, services, errors, from measured before/after probes and cleanup outcomes.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
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
    lessons: [
      'A stopped application does not establish that its dependency containers or guest stopped.',
      'Unavailable probes leave cleanup unverified; do not infer success from missing measurements.',
      'Free-memory changes include unrelated workloads and operating-system caches.',
    ],
    recoverySteps:
      errors.length ||
      services.some((service) => service.running !== false) ||
      after.some((sample) => !sample.available)
        ? [
            'Inspect services, errors and unavailable host samples in this report.',
            'Verify the configured Docker context, guest state and SSH reachability on the dependency host.',
            'Check listener ownership and owner activity before retrying the scoped stop action.',
          ]
        : [
            'Retained records support restart. Use explicit reset only when you intend to erase business data.',
          ],
    retained: [
      'Operator stays running for control and recovery.',
      'Database volumes, images, build caches and retained logs stay on disk.',
      'Free-memory changes include operating-system caches and unrelated workloads; no idle baseline has been certified.',
    ],
  };
}
