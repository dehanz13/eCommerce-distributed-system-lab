# Unit and module test inventory

Generated 2026-10-05T06:08:13.969Z from the run started 2026-10-05T06:08:03.624Z. Source: Vitest JSON assertion results. Passed 183; failed 0; skipped/pending 0.

Regenerate with `pnpm test` or `pnpm test:coverage`. A checked box means this test passed in that run. Unchecked items carry their actual status; they do not imply every unexecuted test failed. Integration/browser checks have separate commands and do not appear in this unit inventory. Collection failures are listed separately. This is a dated snapshot, not a live indicator.

Tests use good and rejected fictional inputs at public boundaries. Pure policies use literal expected values. SQL tests apply the real migrations to an in-memory PostgreSQL engine; locking across real connections is covered separately. HTTP/process mocks represent external boundaries and do not establish live-service readiness. See [testing standards](runtime-observation.md#test-evidence).

## Operator observation collection · tests/activity-collection.test.ts

- [x] collects valid source data and labels unavailable owners rather than inventing an empty healthy stream — **passed** (15 ms)
- [x] rejects an invalid activity reply at the real runtime contract boundary — **passed** (0 ms)

## Web · tests/architecture-flow.test.ts

- [x] maps cache observations, operator controls and uncertain health without inventing hops — **passed** (4 ms)
- [x] observed architecture journeys joins replay requests by scoped reference and leaves ambiguous correlation-only logs separate — **passed** (1 ms)
- [x] observed architecture journeys does not infer unobserved work from an accepted response or missing activity — **passed** (0 ms)
- [x] observed architecture journeys keeps retries as activity until a terminal attempt and compensation are observed — **passed** (0 ms)
- [x] observed architecture journeys shows a rejected checkout without inventing an order or database milestone — **passed** (1 ms)
- [x] observed architecture journeys deduplicates overlapping activity snapshots and preserves correlation separation — **passed** (0 ms)
- [x] observed architecture journeys does not evict a checkout merely because unrelated reads are newer — **passed** (0 ms)
- [x] observed architecture journeys never treats stale cached readiness or an unreachable owner as proof of database health — **passed** (0 ms)
- [x] matches checkout HTTP observations within a larger shopper correlation — **passed** (0 ms)

## Shared tooling · tests/backend-console.test.ts

- [x] keeps connector lanes clear of cards and other connectors — **passed** (11 ms)
- [x] serves the backend console, local module and editable scene independently of shopper routes — **passed** (36 ms)
- [x] reports partial outages, redacts sampled secrets and validates the public snapshot contract — **passed** (39 ms)
- [x] preserves a valid degraded 503 health report and rejects malformed health fields — **passed** (2 ms)
- [x] keeps malformed or missing proxy evidence unavailable: {} — **passed** (1 ms)
- [x] keeps malformed or missing proxy evidence unavailable: {"lab-rabbitmq":{}} — **passed** (1 ms)
- [x] keeps malformed or missing proxy evidence unavailable: {"lab-rabbitmq":{"enabled":"false"}} — **passed** (1 ms)
- [x] keeps malformed or missing proxy evidence unavailable: {"lab-rabbitmq":null} — **passed** (1 ms)

## Operator replay ordering · tests/backend-flow-order.test.ts

- [x] keeps earlier processing before a later republish and duplicate delivery of the same event — **passed** (3 ms)
- [x] preserves preceding receipt evidence without mutating the supplied snapshot — **passed** (0 ms)
- [x] does not invent parentage from a later retry when the original attempt is absent — **passed** (0 ms)

## Ordering · tests/catalog-cache.test.ts

- [x] revisioned catalog cache returns authoritative catalog data when a cache fill fails — **passed** (2 ms)
- [x] revisioned catalog cache fills a cold key and serves a hit without another catalog load — **passed** (0 ms)
- [x] revisioned catalog cache cannot select a stale revision after a late fill completes — **passed** (52 ms)
- [x] revisioned catalog cache coalesces overlapping loads within this ordering process — **passed** (52 ms)
- [x] revisioned catalog cache rejects corrupt cached JSON and replaces it with validated database data — **passed** (0 ms)
- [x] revisioned catalog cache falls back when cache lookup fails without masking database failure — **passed** (1 ms)
- [x] revisioned catalog cache cleans failed fills so a later request can recover — **passed** (0 ms)

## Ordering · tests/checkout.test.ts

- [x] reserves stock, snapshots items, empties the cart and records an event atomically — **passed** (30 ms)
- [x] recovers an accepted response before checking the emptied cart and rejects key reuse — **passed** (18 ms)
- [x] requires a bounded key and a known cart — **passed** (9 ms)
- [x] scopes tracing references to the shopper even when two shoppers choose the same key — **passed** (21 ms)
- [x] requires reconfirmation after contents or price changes and keeps the cart — **passed** (17 ms)
- [x] rejects empty, inactive and short-stock carts without a partial order — **passed** (15 ms)
- [x] rolls back reservation, order and cart changes if saving the outgoing event fails — **passed** (19 ms)
- [x] compensates once despite duplicate and contradictory terminal outcomes — **passed** (23 ms)
- [x] fulfills once and refuses a recovery cart for accepted or fulfilled orders — **passed** (14 ms)
- [x] does not permanently deduplicate an unknown-order outcome before its effects commit — **passed** (7 ms)
- [x] fingerprints prices independently of item order without mutating the input — **passed** (12 ms)

## Client wrapper · tests/client.test.ts

- [x] sends requests and records valid identifiers on local HTTP without randomUUID — **passed** (37 ms)
- [x] retries one transient read but never repeats checkout — **passed** (254 ms)
- [x] does not retry client validation errors — **passed** (1 ms)
- [x] bounds transport retries and respects an explicitly aborted read — **passed** (253 ms)
- [x] correlates browser input, transport and output while redacting fictional sensitive fields — **passed** (2 ms)

## Configuration · tests/configuration.test.ts

- [x] starts web configuration with only public origins and prefers .env.web over backend settings — **passed** (3 ms)
- [x] accepts the committed single-machine example and optional empty remote settings — **passed** (0 ms)
- [x] reports all missing required settings together without substituting defaults — **passed** (1 ms)
- [x] rejects an invalid dependency port: 0 — **passed** (0 ms)
- [x] rejects an invalid dependency port: 65536 — **passed** (0 ms)
- [x] rejects an invalid dependency port: 1.5 — **passed** (0 ms)
- [x] rejects an invalid dependency port: not-a-port — **passed** (0 ms)
- [x] rejects an unsafe service origin without logging its value — **passed** (0 ms)
- [x] rejects an unsafe service origin without logging its value — **passed** (0 ms)
- [x] rejects an unsafe service origin without logging its value — **passed** (0 ms)
- [x] rejects an unsafe service origin without logging its value — **passed** (0 ms)
- [x] rejects an unsafe service origin without logging its value — **passed** (0 ms)
- [x] rejects an unsafe service origin without logging its value — **passed** (0 ms)
- [x] rejects 'ORDERING_URL' when 'http://localhost' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'ORDERING_URL' when 'https://localhost' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'ORDERING_URL' when 'http://localhost:80' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'ORDERING_URL' when 'https://localhost:443' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'ORDERING_URL' when 'http://localhost:0' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'FULFILLMENT_URL' when 'http://localhost' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'FULFILLMENT_URL' when 'https://localhost' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'FULFILLMENT_URL' when 'http://localhost:80' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'FULFILLMENT_URL' when 'https://localhost:443' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'FULFILLMENT_URL' when 'http://localhost:0' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'OPERATOR_URL' when 'http://localhost' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'OPERATOR_URL' when 'https://localhost' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'OPERATOR_URL' when 'http://localhost:80' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'OPERATOR_URL' when 'https://localhost:443' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'OPERATOR_URL' when 'http://localhost:0' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'WEB_URL' when 'http://localhost' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'WEB_URL' when 'https://localhost' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'WEB_URL' when 'http://localhost:80' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'WEB_URL' when 'https://localhost:443' has no usable lifecycle port — **passed** (0 ms)
- [x] rejects 'WEB_URL' when 'http://localhost:0' has no usable lifecycle port — **passed** (0 ms)
- [x] allows a default-port proxy destination because lifecycle commands do not extract its port — **passed** (0 ms)
- [x] requires remote host, account and directory only for two-machine operation — **passed** (0 ms)
- [x] names missing optional settings when a command needs them — **passed** (0 ms)
- [x] reports a missing source file and the setup location without printing personal paths — **passed** (0 ms)
- [x] loads a complete file and leaves its contents out of configuration errors — **passed** (1 ms)

## Quality tooling · tests/coverage-report.test.ts

- [x] reports the business gate and untested overall/system code separately without publishing host paths — **passed** (160 ms)
- [x] fails a business result at 90% while still writing the report — **passed** (118 ms)
- [x] fails when a listed business module is absent from the collected scope — **passed** (54 ms)

## Shared tooling · tests/database-connectivity.test.ts

- [x] observes a disconnected checked-out connection without an unhandled error event — **passed** (4 ms)
- [x] rejects interrupted work, attempts rollback, releases the connection and can accept later work — **passed** (1 ms)

## Ordering, Fulfillment and event contracts · tests/domain.test.ts

- [x] business guarantees uses integer money and rejects invalid quantities — **passed** (1 ms)
- [x] business guarantees has a bounded deterministic processing budget — **passed** (0 ms)
- [x] business guarantees never reverses terminal orders — **passed** (0 ms)
- [x] business guarantees rejects contradictory event payloads — **passed** (3 ms)

## Operator · tests/experiments.test.ts

- [x] captures and restores the cache-outage exercise with bounded progress — **passed** (18 ms)
- [x] captures and restores the broker-outage exercise with bounded progress — **passed** (3 ms)
- [x] captures and restores the database-outage exercise with bounded progress — **passed** (3 ms)
- [x] captures and restores the fulfillment-restart exercise with bounded progress — **passed** (2 ms)
- [x] captures and restores the network-latency exercise with bounded progress — **passed** (3 ms)
- [x] captures and restores the network-cut exercise with bounded progress — **passed** (2 ms)
- [x] captures and restores the slow-processing exercise with bounded progress — **passed** (2 ms)
- [x] captures and restores the retry-processing exercise with bounded progress — **passed** (2 ms)
- [x] captures and restores the failed-processing exercise with bounded progress — **passed** (2 ms)
- [x] refuses an unhealthy baseline and records unavailable snapshots — **passed** (2 ms)
- [x] requires explicit restoration after cleanup fails, then restores only named lab targets — **passed** (3 ms)
- [x] records a proxy mutation failure without reporting the exercise as successful — **passed** (2 ms)
- [x] drains an interrupted exercise and awaits restoration before shutdown can finish — **passed** (3 ms)
- [x] restores the cache-outage fault when shutdown interrupts its active window — **passed** (3 ms)
- [x] restores the broker-outage fault when shutdown interrupts its active window — **passed** (2 ms)
- [x] restores the database-outage fault when shutdown interrupts its active window — **passed** (3 ms)
- [x] restores the fulfillment-restart fault when shutdown interrupts its active window — **passed** (3 ms)
- [x] restores the network-latency fault when shutdown interrupts its active window — **passed** (2 ms)
- [x] restores the network-cut fault when shutdown interrupts its active window — **passed** (2 ms)
- [x] restores the slow-processing fault when shutdown interrupts its active window — **passed** (2 ms)
- [x] restores the retry-processing fault when shutdown interrupts its active window — **passed** (3 ms)
- [x] restores the failed-processing fault when shutdown interrupts its active window — **passed** (2 ms)
- [x] reports failed shutdown restoration and retains explicit recovery state — **passed** (2 ms)
- [x] restores the active fault even if writing its shutdown progress fails — **passed** (3 ms)
- [x] does not apply a fault if shutdown arrives while the baseline is being captured — **passed** (2 ms)
- [x] does not exit on SIGTERM until the active exercise has restored its dependency — **passed** (3 ms)

## Shopper feeder · tests/feeder.test.ts

- [x] preserves an unknown checkout and recovers its original submission before another run — **passed** (68 ms)
- [x] runs accepted and abandoned shopper journeys and accounts for their requests — **passed** (144 ms)
- [x] stops new shoppers, finishes active work and retains a terminal run report — **passed** (53 ms)
- [x] clears definitive checkout rejections but retains transport failures for recovery — **passed** (104 ms)
- [x] records a failed catalog setup without starting shopper transactions — **passed** (53 ms)

## Fulfillment · tests/fulfillment.test.ts

- [x] commits the inbox and one job, deduplicates delivery and snapshots the preset — **passed** (56 ms)
- [x] does not spend processing attempts on dependency outages or a paused queue — **passed** (37 ms)
- [x] waits for the five-second deadline and resumes the same attempt after restart, even while paused — **passed** (33 ms)
- [x] fails once, preserves a one-second retry deadline, then commits success and its event — **passed** (45 ms)
- [x] exhausts exactly three attempts with one- and five-second retry delays — **passed** (34 ms)
- [x] rolls back the final attempt and job if its outcome cannot be stored — **passed** (58 ms)
- [x] keeps at most one active attempt when multiple jobs wait — **passed** (23 ms)

## Shared contracts and runtime · tests/http-contract.test.ts

- [x] serializes a product response matching the shared runtime contract — **passed** (49 ms)
- [x] rejects invalid and extra write fields without silently changing the submission — **passed** (4 ms)
- [x] reports malformed JSON as a client error rather than a dependency outage — **passed** (1 ms)
- [x] preserves stable business error codes and request identifiers — **passed** (2 ms)
- [x] exports observed request/response activity with correlation and timing metadata — **passed** (8 ms)
- [x] rejects excessive shopper traffic and unknown fault scenarios at the contract seam — **passed** (24 ms)
- [x] requires preset values and rejects ignored or misdirected control parameters before accepting an action — **passed** (29 ms)

## Shared tooling · tests/lifecycle-cleanup.test.ts

- [x] continues shutdown after failure/timeout and records every owned closer without leaking its error — **passed** (14 ms)
- [x] removes only allowlisted generated files and retains recovery, source, configuration and evidence — **passed** (4 ms)
- [x] saves a refused-cleanup report and leaves artifacts intact when local state is active or unknown — **passed** (2 ms)
- [x] drains in-flight owner work before releasing its scheduling loop — **passed** (3 ms)
- [x] refuses a symlinked artifact ancestor and never deletes its external target — **passed** (3 ms)
- [x] allows bounded exercise restoration beyond the ordinary connection-close deadline — **passed** (2 ms)

## Shared tooling · tests/logs.test.ts

- [x] bounds repeated viewer failures and reports recovery without changing service state — **passed** (20 ms)

## Operator host monitoring · tests/monitor.test.ts

- [x] opens the single guest monitor on its owning host — **passed** (32 ms)
- [x] opens the two guest monitor on its owning host — **passed** (15 ms)

## Shared runtime · tests/observation.test.ts

- [x] records input, processing and output with one trace and redacts nested credentials — **passed** (18 ms)
- [x] logs rejected business submissions and keeps successful health polling quiet — **passed** (3 ms)
- [x] bounds payloads and preserves a successful response if the activity sink fails — **passed** (4 ms)
- [x] summarizes identical dependency failures and records recovery without idle success logs — **passed** (4 ms)
- [x] does not let a polling header suppress business write observations — **passed** (1 ms)

## Shared tooling · tests/operator-inspection.test.ts

- [x] serves the actual recovery page and documents its HTML content type — **passed** (32 ms)
- [x] serializes the collected report and validates it through the browser contract — **passed** (36 ms)

## Operator · tests/operator-lifecycle.test.ts

- [x] stops an owned orphan listener even when the recorded launcher has exited — **passed** (4 ms)
- [x] refuses both stopping and starting over a listener from another checkout — **passed** (1 ms)
- [x] starts TypeScript in the recorded process and verifies that it owns the listener — **passed** (1 ms)
- [x] accepts Linux socket ownership despite a truncated Next process name — **passed** (1 ms)
- [x] refuses Linux lifecycle changes when a listening socket hides its owner — **passed** (1013 ms)
- [x] waits for a retiring Linux socket after its owned process has stopped — **passed** (37 ms)
- [x] tears down only the lab project without deleting volumes and saves measured shutdown evidence — **passed** (20 ms)
- [x] continues container cleanup after an unowned local listener and never certifies it as stopped — **passed** (6 ms)
- [x] persists an unverified report when the container host fails cleanup — **passed** (10 ms)
- [x] restarts the entire lab only after verified teardown and returns its stop report — **passed** (69 ms)
- [x] releases only the configured dedicated guest and reports its retained disk — **passed** (116 ms)
- [x] controls a local dedicated guest while preserving volumes and measuring its own scope — **passed** (213 ms)
- [x] creates and refreshes a private guest projection before Compose in a fresh single-host checkout — **passed** (35 ms)

## Publication tooling · tests/public-content.test.ts

- [x] rejects private files and identifying values without echoing their contents — **passed** (2 ms)
- [x] accepts the fictional environment example and public project URL — **passed** (0 ms)
- [x] checks visible diagram labels without interpreting editor ordering tokens as documentation — **passed** (0 ms)
- [x] continues scanning all diagram metadata for private paths and rejects malformed scenes — **passed** (0 ms)

## Operator · tests/resources.test.ts

- [x] reports measured changes and retained allocations without claiming baseline restoration — **passed** (4 ms)
- [x] fails verification for a remaining service or unavailable measurement — **passed** (0 ms)

## Shared tooling · tests/shell.test.ts

- [x] round-trips a literal shell argument: "" — **passed** (8 ms)
- [x] round-trips a literal shell argument: "apostrophe ' and space" — **passed** (9 ms)
- [x] round-trips a literal shell argument: "double \" and $variable; $(printf injected)" — **passed** (5 ms)
- [x] round-trips a literal shell argument: "line one\nline two" — **passed** (6 ms)
- [x] preserves Python source through the host shell and nested guest shell — **passed** (12 ms)

## Shopper feeder · tests/shopper-behavior.test.ts

- [x] repeats shopper choices with a seed while retaining bounded quantities — **passed** (19 ms)

## Shared tooling · tests/submission-journey.test.ts

- [x] retains one scoped key reference through replay, worker restart and success outcome — **passed** (143 ms)
- [x] retains one scoped key reference through replay, worker restart and retry outcome — **passed** (72 ms)
- [x] retains one scoped key reference through replay, worker restart and fail outcome — **passed** (68 ms)
- [x] accepts legacy events and rejects malformed or raw-key tracing metadata — **passed** (1 ms)

## Quality tooling · tests/test-inventory.test.ts

- [x] records only observed assertion statuses with relative paths, including failed and skipped cases — **passed** (13 ms)
