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
/** Read bounded local owner windows, filter optional caller identity, and print new structured requests/events/results without duplicates.
 * Input: no arguments; uses its current owner state, from CLI owner/identity selection and already sanitized local owner activity.
 * Communicates with local activity files and terminal output; no remote service control.
 */
function follow() {
  try {
    const records = (owner === 'all' ? owners : [owner])
      .flatMap((name) => readActivity(name))
      .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
    for (const record of records) {
      const id = String(record.id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (!identity || record.correlationId === identity || record.submissionReference === identity)
        console.log(JSON.stringify(safeObservation(record)));
    }
    while (seen.size > 600) seen.delete(seen.values().next().value!);
  } catch {
    console.error('[logs] Local observations unavailable; check .lab/logs permissions. Retrying.');
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
