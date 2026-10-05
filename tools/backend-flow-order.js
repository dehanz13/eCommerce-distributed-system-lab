/** Order a bounded batch by recorded UTC time and explicit request/event dependencies.
 * Input: newly collected owner records; matching publish attempts precede delivery and SQL results follow their step.
 * This orders available evidence only; missing records or unsynchronized host clocks cannot establish a complete global order.
 */
export function orderedActivity(records) {
  const remaining = [...records].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );
  const ordered = [];
  /** Match only preceding event evidence; a durable ID alone cannot distinguish retries.
   * Inputs are child/parent records from this bounded snapshot, expected type and optional owner constraint.
   * Reads local records only; incomplete or skewed evidence never invents parentage from a future attempt.
   */
  const eventParent = (child, parent, type, sameOwner = false) =>
    parent.type === type &&
    (!sameOwner || parent.owner === child.owner) &&
    Date.parse(parent.occurredAt) <= Date.parse(child.occurredAt);
  while (remaining.length) {
    const index = remaining.findIndex(
      (child) =>
        !remaining.some(
          (parent) =>
            parent.id !== child.id &&
            ((child.eventId &&
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
