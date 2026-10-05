const lessons = [
  {
    title: 'Request ≠ completed purchase',
    how: 'HTTP can return an accepted order before fulfillment finishes. Correlation IDs connect the later events.',
    try: 'Choose slow processing in Failure Lab, then run a checkout. Watch accepted remain visible while the job processes.',
    recover:
      'If the checkout response is lost, recover the exact saved submission with its original idempotency key. A new key can create another purchase.',
  },
  {
    title: 'Outbox ≠ message already delivered',
    how: 'The transaction writes an outbox row alongside the order. Publication confirmation is observed later.',
    try: 'Run broker outage, then start shoppers. Compare accepted orders and pending outbox counts before and during the outage.',
    recover:
      'Let the exercise restore RabbitMQ. The publisher retries the same event ID; consumers deduplicate committed effects.',
  },
  {
    title: 'Processing failure ≠ dependency outage',
    how: 'The retry preset spends processing attempts. A disconnected database or broker preserves pending work.',
    try: 'Compare retry processing with network cut. Inspect attempts, retry deadlines and connectivity separately.',
    recover:
      'Restore connectivity for outages. Failed purchases need a new cart and fresh price/availability confirmation.',
  },
  {
    title: 'Pause ≠ immediate stop',
    how: 'Pause finishes the active attempt and prevents another one starting. Immediate stop relies on durable restart recovery.',
    try: 'Choose slow processing, submit an order, then pause from Controls. Compare with fulfillment restart in Failure Lab.',
    recover:
      'Resume paused processing, or manually restart a crashed process. A stale dashboard alone does not prove a crash.',
  },
];
/** Explain the current lab’s guarantees and recovery exercises.
 * Input: no arguments; uses its current owner state, from React props, current browser state and explicit user actions.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function LearningGuide() {
  return (
    <section className="panel p-5">
      <h2 className="text-lg font-semibold">Learn by changing one thing</h2>
      <p className="hint mt-2">
        Hover or focus a map piece for a quick explanation. Open a lesson for an exercise and
        recovery steps.
      </p>
      <div className="learning-grid">
        {lessons.map((x) => (
          <details key={x.title} className="learning-card">
            <summary>{x.title}</summary>
            <p className="mt-3">{x.how}</p>
            <p className="mt-3">
              <strong>Try:</strong> {x.try}
            </p>
            <p className="mt-3">
              <strong>Recover:</strong> {x.recover}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
