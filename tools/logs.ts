import { readActivity, safeObservation } from '@lab/runtime/observation';
const [owner = 'all', identity] = process.argv.slice(2);
const owners = ['ordering', 'fulfillment', 'operator'];
if (
  (!owners.includes(owner) && owner !== 'all') ||
  (identity && !/^(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(identity))
) {
  throw new Error(
    'Use pnpm logs [all|ordering|fulfillment|operator] [correlation UUID|submission reference]',
  );
}
const seen = new Set<string>();
let unavailable = false;
let lastFailureAt = 0;
let suppressedFailures = 0;
/** Read bounded local owner windows, filter optional caller identity, and print new structured requests/events/results without duplicates.
 * Input: no arguments; uses its current owner state, from CLI owner/identity selection and already sanitized local owner activity.
 * Communicates with local activity files and terminal output; no remote service control.
 */
function follow() {
  try {
    const records = (owner === 'all' ? owners : [owner])
      .flatMap((name) => readActivity(name))
      .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
    if (unavailable) console.error('[logs] Local observations recovered.');
    unavailable = false;
    suppressedFailures = 0;
    for (const record of records) {
      const id = String(record.id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (!identity || record.correlationId === identity || record.submissionReference === identity)
        console.log(JSON.stringify(safeObservation(record)));
    }
    // Retain every visible owner's IDs; a busy owner must not evict a quiet owner's window.
    const retainedIds = new Set(records.map((record) => String(record.id)));
    for (const id of seen) if (!retainedIds.has(id)) seen.delete(id);
  } catch {
    const now = Date.now();
    if (!unavailable || now - lastFailureAt >= 30000) {
      console.error(
        '[logs] Local observations unavailable; check .lab/logs permissions. Retrying.',
        { suppressedFailures },
      );
      lastFailureAt = now;
      suppressedFailures = 0;
    } else suppressedFailures++;
    unavailable = true;
  }
}
console.error(
  '[logs] Following local structured activity. Ctrl+C stops this viewer; backend processes keep running.',
);
follow();
const timer = setInterval(follow, 500);
/** Release this viewer's timer on terminal exit; it never closes the observed backend processes.
 * Input: no arguments; uses its current owner state, from CLI owner/identity selection and already sanitized local owner activity.
 * Communicates with local activity files and terminal output; no remote service control.
 */
function stop() {
  clearInterval(timer);
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
