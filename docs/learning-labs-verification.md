# Learning lab verification — 2026-10-02

The canonical repository implements the Redis catalog cache, simulated shopper population, nine scoped failure exercises, and the expanded Architecture dashboard. The interactive application remains in single-machine mode on M3. A separate MBP19 Linux guest was provisioned, measured and tested without sharing the Hearso guest.

## Observed verification

| Check                                            | Result                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, ESLint/accessibility rules, Prettier | Passed through `pnpm quality`                                                                                                                                                                                                                                          |
| Unit and HTTP-contract suite                     | 30 tests passed across eight files                                                                                                                                                                                                                                     |
| Unit coverage                                    | 27.95% lines, 69.29% branches, 60.21% functions over the configured full application/package/tool scope                                                                                                                                                                |
| Production frontend                              | Build passed; rebuilt web process loaded successfully                                                                                                                                                                                                                  |
| Transaction integration                          | Passed: last-stock competition, atomic preservation, cart/price reconfirmation, last-write-wins edits, accepted-key replay, conflicting key reuse, fulfillment failure, compensation deduplication and recovery cart                                                   |
| Durable recovery after the lifecycle fix         | Passed: discarded accepted-response replay, same recorded attempt after immediate restart, duplicate accepted delivery, broker-outage outbox recovery, database outage/recovery                                                                                        |
| Learning integration                             | All nine named failure exercises passed, plus catalog revision invalidation; diagnostic evidence retained separately                                                                                                                                                   |
| Final browser suite                              | All 11 journeys passed in the pinned Linux Node 24 / Playwright container, with a 1 GiB limit and two CPU allocation; approximately one minute                                                                                                                         |
| Browser coverage                                 | Shop/fulfillment, reconfirmation, unknown checkout recovery, failed-order recovery, architecture observation/replay/pause/mobile/reduced motion, outage recovery, cache miss/hit/corruption, shopper traffic, keyboard map explanations, failure snapshots/restoration |
| Feeder recovery                                  | Unit test proves exact retained body/key replay and new-run blocking; loaded live route returns the expected `SUBMISSION_NOT_FOUND` Problem Details for a missing submission                                                                                           |
| Operator reload                                  | Listener ownership matches the recorded replacement PID; regression tests cover orphaned listeners, foreign checkout refusal and direct TypeScript process startup                                                                                                     |
| Live API documents                               | Exported from running owners; recovery route included; repository formatting applied                                                                                                                                                                                   |
| Local readiness                                  | At 09:24:32 UTC all four applications were reachable and ready; no pending fulfillment events, success preset, processing resumed                                                                                                                                      |

Cache unit tests cover cold/hit reads, concurrent fill coalescing, invalid JSON, cache failures, revision changes and failed-fill cleanup. Redis is used only for catalog reads. SQL remains authoritative for revision checks, preview and checkout. Integration/browser results do not inflate unit coverage.

The full final browser suite passed after correcting tooltip focus behavior, checkout HTTP milestone selection, and reload ownership. Tests intentionally create fictional records and interrupt only lab-owned dependencies. No reset was required for these checks.

## MBP19 measured baseline

The dedicated `ecommerce-lab` guest uses four vCPUs, 4 GiB RAM and a 40 GiB sparse disk limit. Ubuntu, Docker/Compose, btop and container image references are pinned in the repository. Guest Compose commands explicitly use this guest rather than MBP19's default Docker context. The existing 12 GiB Hearso guest was left separate.

At 08:53:44 UTC, the five lab containers reported approximately 336.42 MiB combined memory use. Linux reported about 2.94 GiB available RAM and 32.3 GiB available root disk. A nearby btop frame reported 2.90 GiB available guest memory. The Mac host frame reported 16.5 GiB available and 2.78 GiB swap in use. These are post-verification baseline samples, not workload peaks or proof of the eight-GB target.

Transaction integration passed using a temporary ordering process inside the dedicated guest with its PostgreSQL, RabbitMQ, Redis, AMQP proxy and fulfillment containers. That temporary process was removed. Fulfillment readiness and the proxy were reachable over the tailnet during the earlier verification. The complete two-machine interactive UI has not been switched or certified.

At the final access check, recorded at 09:19:26 UTC, the tailnet hostname did not resolve and SSH plus fulfillment HTTP at the previously verified address timed out. Current remote availability could not be refreshed; the cause was not established. The resource report preserves its measured timestamps rather than treating this timeout as a capacity result.

## Reproduce and inspect

Use the dashboard's Architecture, Cache, Shoppers and Failure Lab tabs. Start an exercise before starting shoppers; its before/during/after snapshots describe observed state and expected behavior. Let restoration finish before another lifecycle operation. Recover retained unknown checkout submissions with their original key before starting another shopper run.

Run `pnpm quality`, `pnpm build`, `pnpm test:integration`, `pnpm test:recovery`, `pnpm test:learning` and `./lab test-browser` as appropriate. Run live interruption suites sequentially against the disposable lab. `./lab reload-operator` explicitly reloads source/configuration changes while preserving other applications. `./lab monitor mbp19` and `./lab monitor lab-vm` open btop when the remote host is reachable.

See [learning contracts and controls](learning-labs.md), [VM reproduction](mbp19-lab-vm.md), and [architecture interpretation](architecture-dashboard.md). A new blank physical machine has not been certified. The local results above were recorded before the first GitHub upload; inspect the [release workflow](git-workflow.md) and pull request for subsequent publication and CI results. Codecov has not been connected, and no service/cloud deployment was performed. The finite exercise catalog does not claim every possible production failure.

Next independent service slices are a deterministic customer data enricher and a checkpointed SFTP/batch processor. Add each to the shared contracts and observed map when its actual data path exists.
