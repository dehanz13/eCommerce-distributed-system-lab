# Architecture dashboard verification — October 2, 2026

Historical slice evidence. See [current learning-lab verification](learning-labs-verification.md) for the Redis, shopper, failure-control and MBP19 results that supersede the earlier readiness and coverage figures below.

The local System Dashboard now exposes an Architecture view. It observes the existing owner activity/status interfaces, shows current runtime ownership and technology, animates newly observed hops, and replays recorded history. Its demo checkout uses real public contracts and saves unknown submissions for explicit recovery.

Verified locally:

- TypeScript, ESLint with zero warnings, Prettier, and production web build pass.
- 17 unit/contract tests pass. Six exercise interpretation of observation gaps, rejection, retries, terminal failure, correlation separation, stale health and busy read traffic. The activity-interface test validates request receipt, response completion, correlation metadata and duration.
- Real integration checks pass for overselling prevention, cart preservation, last-write-wins edits, preview conflicts, idempotency, async failure, stock compensation deduplication and recovery.
- The full seven-journey browser suite passed in the existing Linux Node 24 / Playwright test container. Three architecture journeys passed again after correcting the selector limit: observed hops/replay/pause/mobile/reduced motion; committed checkout with lost response and explicit recovery; broker stop, pending accepted checkout, broker restart and completion of the same correlation.
- The final three architecture checks passed again after the scoped light/dark text-contrast change and after strengthening the demo check to wait for its own acceptance before asserting progress.
- Current measured unit line coverage: 23.41% across the configured application/package/tool scope. The pure architecture interpreter has 95.09% line coverage. Browser/integration results are separate evidence and are not counted in those percentages.

The service controls restored RabbitMQ after each outage check. Tests added fictional carts, orders and products; no reset or GitHub publication was performed. New business fields and migrations were not needed for the dashboard.

Limits: two-second polling, not streamed distributed tracing; current health is not historical health during replay; a diagnostic log can be missing after a crash following commit; activity is bounded; owner unavailability does not establish database unavailability. The MBP19 two-machine deployment remains unverified. Feeder, enrichment, SFTP/batch and Redis are labelled planned and are not implemented by this change.

Implementation guide: [Architecture dashboard](architecture-dashboard.md).
