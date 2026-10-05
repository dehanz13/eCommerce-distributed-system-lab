import type { Product } from '@lab/contracts';

/** Catalog reads tolerate cache failures. Preview and acceptance never use this module. Versioned keys expire after 15 seconds; writes advance the database revision atomically. Concurrent misses for one revision share one load within this ordering process.
 * Input: deps, from ordering’s injected revision/cache/database adapters.
 * Communicates with injected SQL/Redis capabilities; checkout bypasses this cache.
 */
export function catalogCache(deps: {
  revision: () => Promise<string>;
  load: () => Promise<Product[]>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttl: number) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
  valid: (value: unknown) => value is Product[];
  observe: (outcome: string, details: Record<string, unknown>) => void;
}) {
  const fills = new Map<string, Promise<Product[]>>();
  const counts: Record<string, number> = {};
  let lastKey: string | null = null;
  /** Record a bounded diagnostic observation.
   * Input: outcome, correlationId, key, from ordering’s injected revision/cache/database adapters.
   * Communicates with injected SQL/Redis capabilities; checkout bypasses this cache.
   */
  const observe = (outcome: string, correlationId: string, key: string) => {
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    deps.observe(outcome, { correlationId, key, ttlSeconds: 15 });
  };
  return {
    /** Load the next owner-managed observation or record.
     * Input: correlationId, from ordering’s injected revision/cache/database adapters.
     * Communicates with injected SQL/Redis capabilities; checkout bypasses this cache.
     */
    async read(correlationId: string) {
      // The revision read must succeed: Redis is not a database outage replica.
      const key = 'lab:catalog:v' + (await deps.revision());
      lastKey = key;
      observe('lookup', correlationId, key);
      try {
        const raw = await deps.get(key);
        if (raw !== null) {
          let value: unknown;
          try {
            value = JSON.parse(raw);
          } catch {
            value = null;
          }
          if (deps.valid(value)) {
            observe('hit', correlationId, key);
            return value;
          }
          observe('invalid', correlationId, key);
          await deps.remove(key);
        }
        observe('miss', correlationId, key);
      } catch {
        observe('fallback', correlationId, key);
        const value = await deps.load();
        observe('database', correlationId, key);
        return value;
      }
      const pending = fills.get(key);
      if (pending) {
        observe('coalesced', correlationId, key);
        return pending;
      }
      const fill = (async () => {
        const value = await deps.load();
        observe('database', correlationId, key);
        try {
          await deps.set(key, JSON.stringify(value), 15);
          observe('filled', correlationId, key);
        } catch {
          observe('fill_failed', correlationId, key);
        }
        return value;
      })();
      fills.set(key, fill);
      try {
        return await fill;
      } finally {
        fills.delete(key);
      }
    },
    /** Return the current local snapshot without starting new work.
     * Input: no arguments; uses its current owner state, from ordering’s injected revision/cache/database adapters.
     * Communicates with the module’s current local snapshot only; no new network or storage operation.
     */
    inspect: () => ({
      strategy: 'revisioned cache-aside',
      ttlSeconds: 15,
      lastKey,
      counts: { ...counts },
      activeFills: fills.size,
    }),
  };
}
