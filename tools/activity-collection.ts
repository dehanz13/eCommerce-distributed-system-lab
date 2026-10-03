import { cfg, readActivity } from '@lab/runtime';
import { validateReply } from '@lab/contracts';
/** Collect bounded observations without making unavailable producers appear silent or healthy. */
export async function collectActivity(correlationId?: string) {
  const sources = await Promise.all(
    Object.entries({
      ordering: cfg.ORDERING_URL,
      fulfillment: cfg.FULFILLMENT_URL,
      operator: cfg.OPERATOR_URL,
    }).map(async ([owner, url]) => {
      const sampledAt = new Date().toISOString();
      try {
        if (owner === 'operator')
          return {
            owner,
            available: true,
            sampledAt,
            records: readActivity(owner, correlationId),
            error: null,
          };
        const response = await fetch(
          url + '/activity' + (correlationId ? '?correlationId=' + correlationId : ''),
          { signal: AbortSignal.timeout(2500) },
        );
        if (!response.ok) throw new Error('Unavailable producer');
        const payload = await response.json();
        validateReply('/activity', 'GET', payload);
        return {
          owner,
          available: true,
          sampledAt: payload.meta.respondedAt as string,
          records: payload.data as Record<string, unknown>[],
          error: null,
        };
      } catch {
        return {
          owner,
          available: false,
          sampledAt,
          records: [],
          error: 'Source unavailable or contract invalid; recent data not collected.',
        };
      }
    }),
  );
  return {
    sampledAt: new Date().toISOString(),
    exhaustive: false,
    limitPerOwner: 200,
    retentionDays: 7,
    sources,
    records: sources
      .flatMap((x) => x.records)
      .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))),
  };
}
