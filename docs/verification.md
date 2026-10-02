# Group 1 verification — 2026-10-02

Historical slice evidence. See [current learning-lab verification](learning-labs-verification.md) for the Redis, shopper, failure-control and MBP19 results that supersede the earlier readiness and coverage figures below.

Canonical source directory: `/Users/dehanz13/development/projects/ecommerce-fullstack-ecosystem`. The four applications are running with PostgreSQL and RabbitMQ locally. Test records are left in the lab for inspection; reset has been independently verified to erase/reseed managed data.

## Observed checks

| Check                                                                  | Actual outcome                                                                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript, ESLint, React Hooks/accessibility rules, formatting | Passed                                                                                                                                                                                       |
| Unit/HTTP-contract tests                                               | 10 passed across 3 files                                                                                                                                                                     |
| Frontend production build                                              | Passed through the operator's web restart                                                                                                                                                    |
| ShellCheck                                                             | Passed for the executable scripts                                                                                                                                                            |
| Production dependency audit                                            | No known vulnerabilities reported after patch updates                                                                                                                                        |
| Integration guarantees                                                 | Passed: last-stock concurrency, cart preservation, idempotent replay/conflicting key reuse, price/cart reconfirmation, LWW edits, exhausted retries, one-time compensation and recovery cart |
| Recovery guarantees                                                    | Passed: discarded accepted-response replay, same persisted attempt after restart, duplicate accepted-event delivery, durable outbox during broker outage, database outage/recovery           |
| Browser suite                                                          | 4 passed in isolated Linux, Node 24.11.0 / Playwright 1.56.1; last run 19.2 seconds                                                                                                          |
| Browser cases                                                          | Checkout/fulfillment/admin navigation; changed prices; committed checkout with response deliberately lost and original-key recovery; failed-order recovery/reconfirmation                    |
| Live owner inspection                                                  | Product detail contract and job detail with three recorded failed attempts passed                                                                                                            |
| Invalid-event handling                                                 | Malformed message entered quarantine with the owner source; verified message was acknowledged after inspection                                                                               |
| Dashboard controls                                                     | Pause/resume completed; terminal-controlled restart and reset completed                                                                                                                      |
| Fresh managed lab data                                                 | Reset recreated databases/queues and seeded the catalog successfully                                                                                                                         |
| Contracts                                                              | Running owner OpenAPI documents and discriminated version-one event schema exported into docs/contracts/                                                                                     |
| Host monitor                                                           | Existing btop 1.4.7+6e39144 verified; ./lab monitor opens it                                                                                                                                 |

Unit line coverage is **16.94%**; branch coverage is 65.54%, function coverage 50%. The unit coverage scope includes untested application/UI files. Integration and browser checks are separate evidence and do not inflate this percentage. The SVG badge reflects this measured local baseline.

The native macOS Playwright launch was blocked by its process environment. The isolated Linux suite passed without changing Mac browser protections. It found and verified a real portability fix: browser IDs use the standard UUID library so HTTP hostnames work when crypto.randomUUID is unavailable. See [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) and [uuid](https://github.com/uuidjs/uuid).

## Recorded resource sample

At 2026-10-02T07:27:48.039Z, the lab PostgreSQL container used 41.95MiB / 1GiB and RabbitMQ used 89.6MiB / 768MiB. Ordering, fulfillment and operator process RSS were about 44.5, 45.1 and 54.9 MiB respectively. The full sampled values and scope limitations are in docs/resource-snapshot.json. This is one live observation, not a peak benchmark or proof of the eight-GB target. The native web process, launchers and shared Docker Desktop overhead are outside those backend RSS figures.

## Remaining external verification

Two-machine SSH/Compose projection is implemented, but MBP19 VM access and capacity were not verified. A blank physical host has not been provisioned from scratch; Linux locked-dependency installation and local data recreation were verified. GitHub CI and live coverage badges are prepared but not connected/run because a repository URL and coverage integration have not been supplied. No commit, push or cloud deployment was performed. Root personal instructions are excluded by the ignore rules; the chosen source directory has not yet been initialized as a Git repository because metadata creation was blocked in this environment.

## Explore

Open http://localhost:4310 for the shop, /catalog for catalog administration and /system for observation/controls. `./lab` opens the terminal menu. `./lab test-browser` runs the isolated Linux verification suite; `./lab monitor` opens btop. Start services from a normal Terminal so the operator can send their lifecycle signals. Read docs/architecture.md, docs/ontology-and-learning.md and docs/operations.md for the ownership map, state machines, all 17 learning goals and single/two-machine operation.
