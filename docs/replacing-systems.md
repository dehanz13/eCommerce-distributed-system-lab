# Replace a system while preserving the lesson

The lab keeps a small shopper workflow and independently owned ordering and fulfillment state. A replacement can use a vendor implementation behind the existing interface. Replace one module at a time and verify its guarantees before changing another. No vendor integration is implemented by this guide.

## Existing seams

| Replace             | Seam                                                                                           | Guarantees that callers still depend on                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shopper UI          | Ordering HTTP contracts in `packages/contracts`; native-fetch wrapper in `packages/client`     | Preview before acceptance, stable replay submission, explicit unknown-write recovery, validated responses                                                      |
| Ordering            | Configured ordering URL and HTTP/event contracts                                               | Atomic stock reservation, immutable order snapshots, shopper-scoped idempotency, durable accepted event, terminal-state protection and stock compensation once |
| Fulfillment         | Configured fulfillment URL and accepted/outcome event contracts                                | Inbox deduplication, persisted attempts/deadlines, resumable work, durable outcome events, retained submission reference                                       |
| RabbitMQ            | `EventDelivery` in `packages/runtime/src/events.ts`; owner composition in `apps/*/src/main.ts` | Drain committed outbox records, preserve envelopes, confirm durable publication, tolerate repeated delivery, acknowledge only after consumer effects commit    |
| Redis catalog cache | Injected get/set/remove operations in `apps/ordering/src/catalog-cache.ts`                     | Revisioned keys, bounded operations, expiry, invalid-data rejection and SQL fallback; checkout bypasses the cache                                              |
| Operator            | Named-action and observation contracts                                                         | Bounded observations, explicit unavailable/stale states, allowlisted controls, recorded action outcomes and scoped cleanup                                     |
| Owner database      | Owner implementation and migrations                                                            | Preserve local transaction/deduplication guarantees; never read the other owner's tables                                                                       |

The PostgreSQL implementations use PostgreSQL SQL and locking. Another database needs an owner storage implementation; changing a URL does not make a different database compatible. A hosted PostgreSQL replacement can retain those SQL semantics, but its reachability and failure behavior still need testing. Local lab controls currently manage named processes, Compose dependencies and the configured remote guest; vendor lifecycle controls need their own adapter rather than running local stop/reset against a vendor.

Event creation and transactional staging live separately from the RabbitMQ adapter. Business modules import `@lab/runtime/events`, while application entry points select delivery. Replace the delivery factory there; keep business logic unchanged. `EventDelivery` describes the runtime surface, and the guarantees above describe its semantics. A vendor that only offers an HTTP send method still needs an adapter that handles publication uncertainty and consumer acknowledgment. It must never send an external message inside checkout's database transaction in place of the outbox write.

## Follow an idempotency key safely

Ordering scopes checkout keys by shopper. It derives `submissionReference` using SHA-256 over the JSON array `['checkout:v1', shopperId, key]`. The operation tag fixes the scope; structured encoding prevents concatenation ambiguity. Different shoppers using the same key have different references. Replaying the same shopper/key retains the reference even when the HTTP request and correlation IDs change.

The raw key remains in ordering's replay storage and in the caller's retained unresolved submission. Logs, the dashboard and event envelopes use the reference. This fingerprint is diagnostic identity, not an authorization credential or a promise of secrecy for low-entropy keys. Changing a submission body while reusing its key remains a conflict; the fingerprint does not make conflicting submissions valid.

| Identifier                | What it establishes                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Idempotency key + shopper | Which original checkout submission ordering can replay                                 |
| Submission reference      | Which scoped key the journey belongs to across explicit replay, events and restarts    |
| Correlation ID            | One supplied journey context; explicit replay may supply another                       |
| Request ID                | One HTTP attempt                                                                       |
| Event ID                  | One durable fact; repeated publication retains it and inbox processing deduplicates it |
| Causation ID              | Which earlier request/event caused this fact                                           |
| Order/job/attempt ID      | Which business record or processing attempt to inspect                                 |

New orders store the reference with acceptance; accepted events carry it as optional envelope metadata. Fulfillment persists it with the job, records it on attempts and copies it into terminal outcome events. Ordering records it when applying the outcome. It is never an aggregate metric label. Cache and health requests are not checkout submissions and do not acquire a checkout reference.

The dashboard groups retained activity by reference and lists its correlation IDs. Correlation-only records join a reference only when that correlation has one observed reference; ambiguous records stay separate. The reference is available after ordering identifies the shopper, so malformed or unknown-cart requests can lack it. Missing activity and historical references remain unavailable rather than inferred. Server response completion does not prove browser receipt.

## Upgrade and verify

Ordering and fulfillment each have migration `003.cjs`, adding a nullable reference column. Apply both owner migrations before starting the updated applications. Existing orders, stored replay responses, jobs and queued version-one events remain readable without the new metadata. They are not retroactively assigned a reference. Upgrade contract consumers before producers: old strict event validators reject unfamiliar envelope fields even though the updated validator accepts old events.

From a stopped disposable lab, use the documented lab startup path, which applies migrations. For a manually managed lab, run `pnpm exec tsx tools/migrate.ts` against the intended lab databases before restarting the owners. Do not reset existing data merely to apply this additive migration.

`tests/submission-journey.test.ts` exercises real isolated owner SQL engines through their public interfaces: checkout, explicit replay under another correlation, duplicate accepted delivery, worker restart, retries, successful/failed outcome, duplicate outcome delivery and reference retention. Checkout tests verify different shoppers using the same key. These tests do not establish broker durability, multi-connection locking, vendor compatibility or physical LAN behavior; the live integration/recovery suites cover the existing deployment.

Before adopting a replacement, run the same contract and recovery checks with its real adapter: interrupt publication, lose a checkout response, redeliver an event, restart during a persisted attempt, and verify one terminal outcome and compensation at most once. Keep unknown outcomes visible until explicit recovery resolves them.
