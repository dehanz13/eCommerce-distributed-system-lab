/** Order a bounded batch by process sequence, transport identity and explicit request/SQL dependencies.
 * Input: newly collected owner records; publication/delivery IDs distinguish retries, UTC time orders unrelated evidence.
 * This orders available evidence only; missing records or unsynchronized host clocks cannot establish a complete global order.
 */
export function orderedActivity(records) {
  /** Prefer available consumer evidence to an independent retry when UTC timestamps tie; no I/O or claimed global clock. */
  const phase = (record) =>
    record.type === 'event.received' ? 0 : record.type === 'event.publishing' ? 2 : 1;
  const remaining = [...records].sort(
    (a, b) =>
      Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
      phase(a) - phase(b) ||
      a.id.localeCompare(b.id),
  );
  const ordered = [];
  /** Identify records from one process stream whose local positions are known; data comes from the owner activity writer. */
  const sameStream = (child, parent) =>
    child.streamId &&
    child.streamId === parent.streamId &&
    Number.isSafeInteger(child.sequence) &&
    Number.isSafeInteger(parent.sequence);
  /** Match exact transport evidence; legacy records can use strictly earlier times, never a tied retry.
   * Inputs are child/parent records from this bounded snapshot, expected type and optional owner constraint.
   * Reads local records only; incomplete or skewed evidence never invents parentage from a future attempt.
   */
  const eventParent = (child, parent, type, sameOwner = false) => {
    if (parent.type !== type || (sameOwner && parent.owner !== child.owner)) return false;
    const identity = type === 'event.received' ? 'deliveryId' : 'publicationId';
    if (child[identity] || parent[identity])
      return Boolean(child[identity] && child[identity] === parent[identity]);
    return Date.parse(parent.occurredAt) < Date.parse(child.occurredAt);
  };
  while (remaining.length) {
    const index = remaining.findIndex(
      (child) =>
        !remaining.some(
          (parent) =>
            parent.id !== child.id &&
            // Never make a known earlier local record wait for a later one in its own process.
            (!sameStream(child, parent) || parent.sequence < child.sequence) &&
            (sameStream(child, parent) ||
              (child.eventId &&
                child.eventId === parent.eventId &&
                ((child.type === 'event.received' &&
                  eventParent(child, parent, 'event.publishing')) ||
                  (eventParent(child, parent, 'event.received', true) &&
                    !['event.received', 'event.publishing', 'event.published'].includes(
                      child.type,
                    )) ||
                  (child.type === 'event.published' &&
                    eventParent(child, parent, 'event.publishing', true)))) ||
              (child.requestId &&
                child.requestId === parent.requestId &&
                ((child.type === 'http.completed' && parent.type !== 'http.completed') ||
                  (child.type !== 'http.received' && parent.type === 'http.received'))) ||
              (child.transactionId &&
                child.transactionId === parent.transactionId &&
                child.step === parent.step &&
                /transaction.step_(result|failed)/.test(child.type) &&
                parent.type === 'transaction.step')),
        ),
    );
    ordered.push(remaining.splice(index < 0 ? 0 : index, 1)[0]);
  }
  return ordered;
}
