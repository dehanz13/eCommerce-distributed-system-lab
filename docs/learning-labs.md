# Cache, shoppers and failure exercises

The system dashboard contains Architecture, Cache, Shoppers and Failure Lab alongside owner records, activity, metrics and lifecycle controls. All observations are polled every two seconds, with one refresh in flight. Paused/failed/older-than-ten-second observations are explicitly stale.

## Small interfaces and ownership

Ordering owns a revisioned cache-aside catalog module. A PostgreSQL statement trigger advances the catalog revision in the same transaction as every product insert/update/delete, including stock reservation and failure compensation. Keys are `lab:catalog:v{revision}`, with a 15-second TTL. An old request may fill its old revision; new requests cannot select that key. An individual in-flight response is still a snapshot, not a continuous read guarantee.

Redis is disposable, limited to 96 MiB, uses allkeys-LRU eviction, and has no persistence. Its container limit is 128 MiB. Cache misses and expired/evicted keys load SQL, then fill Redis. Invalid JSON is removed. Cache lookup/fill failures fall back to SQL; a SQL outage remains an error because the authoritative revision cannot be checked. Checkout and preview bypass the cache. Concurrent fills for one revision coalesce within a single ordering process; this is not a distributed stampede lock. Redis commands have a 600 ms observation deadline, offline queuing disabled and a bounded client queue. A timed-out fill can still complete later; it only writes its revisioned, expiring key.

Operator owns the shopper and experiment modules. The feeder uses the shared typed native-fetch wrapper and public ordering contracts. It creates three run-owned fictional products and independent anonymous shopper carts. Quantities are 1–3; approximately 15% abandon. Seeded choices repeat, while identifiers, timing and concurrent outcomes vary. Runs are bounded to 500 shoppers and 20 active journeys. Request counts represent logical wrapper calls; a transient GET retry can send two HTTP requests. Accepted counts checkout acceptance, not fulfillment completion. Stop prevents new shoppers and finishes active journeys. Exact unresolved checkout submissions are persisted before send, and retained on unknown outcome. No automatic checkout retry or automatic interrupted-run resume occurs. Outcomes retain the latest 200 shoppers; unresolved submissions retain all unknowns within the bounded run.

A new feeder run replaces the previous run report only after all unresolved submissions are explicitly recovered. The dashboard provides Recover original submission buttons, using the retained body and original key. A definitive client error clears that pending submission; another transport/dependency error keeps it. Run state is replaced atomically on disk, so interruption does not truncate the previous report. Interrupted statistics can remain incomplete. Business records remain owner-managed and are available in Records; use Reset only when you want a fresh lab. Run-owned catalog products remain available for historical inspection and can be deactivated through Catalog Admin.

## Named interfaces

| Owner    | Method and path                    | Purpose                                                                                |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| Ordering | GET `/api/v1/cache`                | Connectivity, cache counters, key and sample time                                      |
| Ordering | POST `/api/v1/cache/actions`       | `clear`, `expire` (one second), or `corrupt` the current lab key                       |
| Operator | GET / POST `/api/v1/feeder`        | Inspect current run / start bounded shoppers                                           |
| Operator | POST `/api/v1/feeder/recover/:id`  | Replay one retained checkout with its original submission and idempotency key          |
| Operator | POST `/api/v1/feeder/stop`         | Stop after active journeys                                                             |
| Operator | GET / POST `/api/v1/experiments`   | Exercise catalog/current report / engage one exercise                                  |
| Operator | POST `/api/v1/experiments/restore` | Explicitly restore lab dependencies, AMQP proxy, success preset and resumed processing |

Inputs and principal output records have shared runtime-validated TypeBox contracts. OpenAPI is exported from running owner servers with `pnpm openapi`. Invalid inputs return Problem Details. Lifecycle mutations are rejected while a feeder or exercise is active. Start an exercise before starting shopper traffic; shoppers may run while that exercise is active. Unknown/interrupted restoration must be explicitly recovered before another exercise.

## Nine reproducible exercises

Cache outage, RabbitMQ outage, PostgreSQL outage, immediate fulfillment termination/restart, AMQP network latency, AMQP network cut, slow processing, first-attempt retry, and exhausted processing retries. Duration is 3–30 seconds. A healthy baseline is required. Each exercise captures baseline, during and restored snapshots, including timestamps and expected behavior. It restores only its changed dependency/setting in a finally block. An operator crash cannot execute finally; persisted status marks restoration unknown and requires Restore lab defaults.

Toxiproxy is limited to a named `lab-rabbitmq` proxy. Apps connect through port 56730, forwarding to RabbitMQ's internal 5672; management stays direct. Network exercises add 750 ms downstream latency or disable that proxy. No host-wide firewall rules are changed. Snapshots are evidence, not an automatic pass/fail verdict. Backlogs can drain after the restored snapshot. This finite catalog does not claim to model every production failure.

## Terminal

`./lab feeder` starts the default 30 shoppers; `./lab feeder status` inspects; `./lab feeder stop` stops new work. `./lab experiment network-cut 12` engages a twelve-second exercise; `./lab experiment status` inspects. `./lab monitor` opens local btop; `./lab monitor mbp19` observes the Mac host and `./lab monitor lab-vm` observes the dedicated guest. `./lab reload-operator` explicitly reloads the operator after source/configuration changes while retaining application process state. Reload checks the listener working directory before termination, handles orphaned listeners from older launchers, and verifies that the replacement process owns its port. A failed stop/start is reported instead of accepting an older process's health response. For remote demonstrations, run btop on the Mac host and in the dedicated Linux guest; neither reading substitutes for the other.

## Learning exercises

Hover or keyboard-focus architecture pieces for ownership/guarantee explanations. Architecture lessons explain request acceptance, outbox delivery, processing failures versus dependency outages, pause versus immediate stop, and explicit recovery. The Cache tab covers cold/hit/expiry/eviction, invalid data, concurrency, write invalidation, late fills, outage/recovery and database outage. Use correlation drill-down to connect observations to the actual request.
