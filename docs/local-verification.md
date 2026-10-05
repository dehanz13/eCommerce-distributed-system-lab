# Local verification checkpoint

Verified on October 4, 2026 (America/Chicago; October 5 UTC). These results describe the working-tree revision deployed during this session, not a published Git revision or a public SDK release.

## Deployment tested

The existing two-machine topology was refreshed through its managed operator. SSH to the backend machine used its Tailscale address. The backend machine's dedicated ecommerce Lima guest hosted PostgreSQL, RabbitMQ, Redis, Toxiproxy and containerized fulfillment. Ordering, operator and shopper web ran on the client machine. This establishes the existing cross-machine flow; it does not establish that ordering and operator have moved to the backend machine.

The refreshed operator served `/architecture` and `/api/v1/backend`, and all ten configured backend observations were available. The architecture renderer describes configured systems, not discovered physical placement. Host counters describe the operator host.

## Results

| Check                                      | Observed result                                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest unit/coverage run before deployment | 155 tests passed                                                                                                                                     |
| Type checking and lint after deployment    | Passed                                                                                                                                               |
| Integration                                | Passed: overselling, preservation, idempotency, price/cart conflicts, last-write-wins, asynchronous failure, compensation deduplication and recovery |
| Recovery                                   | Passed: discarded response replay, recorded-attempt restart, duplicate delivery, broker-outage outbox recovery and database recovery                 |
| Learning controls                          | All nine fault scenarios restored; catalog revision invalidation verified                                                                            |
| Full browser suite                         | All 16 tests passed against the refreshed applications                                                                                               |
| Additional live API stop                   | Shopper remained available; warning appeared; console reported ordering unavailable; warning cleared after restart without reloading the page        |
| Managed restart and named ordering stop    | Cleanup verified; durable volumes and diagnostic reports retained                                                                                    |
| Public-content scan                        | 208 files checked with no configured content-policy matches                                                                                          |

The additional API-stop check used the real process and network, without transport fixtures. Some browser cases deliberately substitute HTTP replies to reproduce uncertain checkout outcomes and partial observations reliably. Together these checks cover actual deployment behavior and controlled failure presentation; they do not prove every possible timing or failure combination.

Private evidence is retained in `.lab/reports/`, including `live-api-availability.json`, with the latest managed cleanup at `.lab/cleanup.json`. Browser screenshots/traces are generated artifacts under `test-results/`. A named stop checks the requested service; it does not claim that dependencies or the VM also stopped. The full restart cleanup verified all managed services before starting them again. OS memory changes do not certify an idle baseline.

## Remaining boundaries

- Running the entire backend group independently on the backend machine requires its own checkout and private configuration. Follow [independent development](independent-development.md) and the [guest runbook](remote-lab-vm.md); use one lifecycle owner per process.
- This checkpoint is uncommitted local work. A fresh Git clone only obtains changes after they are committed and pushed.
- Stripe payments and a distributable client package are design work described in [the reusable API plan](reusable-ecommerce-api.md), not implemented checkout capabilities.
- The console uses a lightweight live SVG renderer and offers an editable Excalidraw scene. Scene structure is tested; importing it in the external Excalidraw editor was not verified in this session.
- Native container stdout and per-container/guest resource counters are not collected by the console. Use the scoped terminal commands in [the console guide](backend-console.md).
- Generated-cache deletion was tested against disposable fixtures. This live checkpoint retained the running lab's build artifacts; it did not prune unrelated caches, Docker images or VM allocations.

## Architecture refinement checkpoint

The subsequent visual refinement passed all 156 unit tests, type checking, lint and the operator browser case. Browser assertions cover flow classification, expiry, pause, dark mode and reduced motion. Desktop/mobile screenshots were inspected, and a real catalog HTTP request highlighted the client-to-ordering connection. Connector geometry checks found no intersections with cards or other links. The full 16-case suite above remains the earlier deployment checkpoint; this visual-only update reran its relevant operator case.

## Expanded ecosystem and ordered replay checkpoint

The diagram now shows both owned database objects and the actual RabbitMQ default exchange, three durable queues, and producer/consumer roles. Bidirectional arrowheads represent request/results, publish/confirms and delivery/acknowledgments. Queue counts come from broker management; database connectivity comes from each owning API's probe. The layout's connector intersection checks passed.

A real fictional checkout completed through both machines without transport fixtures. Its corrected replay captured 84 hops, including both APIs, both owned database paths, accepted-order publication/delivery, outcome publication/delivery, and response/acknowledgment colors. Both queue deliveries appeared before their acknowledgments. The display uses 650 milliseconds per hop and does not alter real processing speed.

The live check exposed an ordering lesson: a consumer can finish before the publisher records confirmation. Replay therefore orders delivery after the matching publish attempt and processing/acknowledgment after receipt, rather than forcing receipt to wait for the publisher's confirmation record. Private reports are retained under `.lab/reports/checkout-replay-*.json`; fictional business records are retained for inspection.

The relevant browser checks cover skewed request/SQL timestamps, matching event delivery/acknowledgment IDs, missing queue evidence, zero consumers, individual database failures, response colors, replay expiry and pause cancellation. The unit run passed all 156 cases. This checkpoint exercises the existing learning lab; it does not add a fan-out exchange, payment service, public SDK or independent packet tracer.

## Final closure checkpoint

The final working-tree check completed on October 5, 2026 UTC (October 4 locally). All 156 unit tests and all 18 browser tests passed, including the three expanded backend-console cases. Type checking, lint, formatting of changed project files, and the public-content scan passed. Formatting excluded the unrelated personal editor configuration. The measured business line coverage was 98%; overall configured line coverage was 51.19%. Browser and live integration results are separate evidence and do not contribute to those unit coverage figures.

After the browser failure scenarios, the live status check at `2026-10-05T04:12:11Z` reported ordering, fulfillment, operator and shopper web ready. Both APIs reported database and broker connectivity. At `2026-10-05T04:12:18Z`, all ten backend-console observations were available; both owned database cards showed Connected and the accepted-order queue showed Available. The refreshed screenshot is `test-results/backend-console-complete-ecosystem.png`.

The integration, recovery and nine learning-control results above remain the earlier backend deployment checks. This closing run reran the complete browser suite against the expanded diagram and kept the lab running. Records, diagnostic reports and running build artifacts remain retained. The work is still a local, uncommitted checkpoint; cloning the remote repository will not include it until it is committed and pushed.
