# Architecture dashboard

Open System Dashboard and select Architecture. The map shows the four applications, RabbitMQ, the Redis catalog cache and both privately owned PostgreSQL databases. Select a piece to inspect its purpose, technology and guarantees. Blue transport motion highlights newly observed hops. Service state is sampled by the operator, not inferred from animation. A missing owner makes its database health unknown; cached observations become stale after ten seconds or when refresh is paused.

The dashboard polls every two seconds. It is a live activity visualizer, not distributed tracing or a network-transit measurement. Pausing refresh preserves inspectable data and marks it stale. Operating-system resource measurements remain in Metrics and btop. Single/two-machine topology comes from the operator configuration; the second machine is not automatically discovered.

## Follow a journey

Run demo checkout to reserve one in-stock fictional product through the real cart, preview and checkout interfaces. It uses the current new-job simulation preset. Use Controls to choose slow (five seconds) before running it to watch the scheduled processing window. Retry and fail show recorded attempts and retry deadlines. Existing jobs retain their preset. The demo saves an unresolved submission in browser storage and offers explicit idempotent recovery; it never automatically retries acceptance.

Select a correlation ID or follow the newest checkout. Include other requests to inspect ordinary HTTP activity. Eleven checkout milestones cover request receipt, transactional acceptance, server response, confirmed accepted-event publication, consumer receipt, job commit, attempt start, terminal processing commit, confirmed outcome publication, outcome receipt and final order commit. A rejected checkout only has HTTP milestones. A failed order can reach full observation coverage: the failure and stock compensation are successful observations of a failed business outcome.

Progress counts observed milestones, not processing work. Missing activity is never filled in by assumption. Server response completion does not establish browser receipt. Publisher confirmation does not establish consumer receipt. The processing-window bar estimates progress against a persisted simulation deadline, remains below 100 until completion is observed, and freezes on stale snapshots. A dependency outage may leave an elapsed deadline waiting for recovery; it does not spend a new attempt.

Replay observed hops animates recorded activity at a compressed pace. It sends no requests, reprocesses no jobs, and does not reconstruct historical service health; health continues to describe the current observation. Inspect JSON event envelopes for the minimal business payload and envelope identifiers. Inspect correlated activity for request/event IDs, millisecond request duration and timestamps. Cross-host ordering depends on synchronized clocks.

## Observation contract and retention

The shared activity schema requires id, owner, type and occurredAt, with typed correlation, request, event and business identifiers when present. Owner diagnostics remain extensible. HTTP activity excludes dashboard status/metrics reads to avoid recursive noise. No HTTP request bodies or credentials are logged for this view.

Checkout and processing observations are emitted after their database transaction commits. These diagnostic logs are not transactional outbox records: a crash after commit but before logging can leave an observation gap. Durable domain records continue to establish business correctness. Activity stays within the existing seven-day/100-MiB per-host budget, and each owner exposes at most 200 recent records. The selector filters checkout journeys before limiting its menu; selected retained activity remains inspectable amid unrelated read traffic. Older activity can age out. A telemetry history store belongs to Group 2.

## Extend the map in working slices

The static pieces/connections and pure activity interpreter live together in apps/web/lib/architecture-flow.ts. The Architecture component owns presentation, replay and explicit demo controls. It receives the existing owner observations; it does not access either database. Add each real service to the registry, give it a validated transport contract, instrument receipt/commit/outcome at its owning interface, then add a journey interpretation and tests. Keep planned pieces separate until their implementation exists.

Suggested next slices:

1. Customer data enricher: a small fictional customer contract and one deterministic enrichment rule, with its own owner state and versioned events.
2. Batch/file processor: local SFTP receipt, row validation, checkpointed processing, quarantine and a batch summary. Add encryption/key routines after the plain-file path is reproducible.

The shopper population, revisioned Redis catalog cache and nine scoped failure exercises are now implemented; see learning-labs.md. The dedicated MBP19 guest has a measured baseline and has passed transaction integration checks. The main interactive application remains on M3. Then add benchmark reporting and richer telemetry as separate learning slices. Add another database model only when a concrete use case justifies it. Avoid a custom gateway while the existing frontend proxy is sufficient.
