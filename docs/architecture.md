# Group 1: one order, four applications

This lab teaches the path from a browser submission to a transaction, durable event, processing attempt and observable outcome. Everything is fictional. There is no signup, payment, carrier integration, or production deployment. A monorepo is one source repository; it does not imply one runtime process or shared database ownership.

![Complete ecosystem, database ownership and actual broker bus](diagrams/01-ecosystem.svg)

The [eight editable Excalidraw drawings](diagrams/README.md) cover checkout, durable fulfillment, broker routing, cache behavior, controls and physical placement. State charts below describe business transitions rather than additional deployed systems.

The current split runs shopper web on the client host; Ordering API, Fulfillment API and Operator API run as independent Node processes on the backend host. Its dedicated Lima guest contains PostgreSQL, RabbitMQ, Redis and Toxiproxy. PostgreSQL hosts two independently owned databases. The console at the operator origin plus `/architecture` works independently of shopper web. See [independent development](independent-development.md) for separate terminal commands.

| Workspace          | Owns                                                                                     | Interface and guarantees                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| apps/web           | Anonymous browser identity, saved unresolved checkout, presentation                      | Shared-contract fetch wrapper; one transient read retry; mutations are never automatically retried |
| apps/ordering      | Products, carts, orders, accepted idempotency results, own outbox/inbox                  | REST CRUD and checkout; no fulfillment-table access                                                |
| apps/fulfillment   | Settings, jobs, attempts, own outbox/inbox                                               | Accepted-event consumption, durable processing and outcome events; no ordering-table access        |
| apps/operator      | Named actions and local host observations                                                | Serial control actions with IDs, progress and requested/started/finished times                     |
| packages/contracts | JSON schemas and transport types                                                         | Runtime validation and generated OpenAPI/event documentation                                       |
| packages/runtime   | Configuration, database transactions, broker delivery, structured activity and telemetry | Shared capabilities; business rules remain inside their owning applications                        |
| packages/client    | Browser request behavior                                                                 | Native fetch, response contract validation, bounded read retry and explicit unknown write outcomes |
| tools              | Migrations, seed, CLI, controlled lifecycle, contract export                             | Uses named services; generated runtime state lives under .lab/                                     |

## Checkout and state machines

A preview observes the cart revision, current product prices, availability and a sorted price fingerprint. It reserves nothing. Acceptance locks the cart, looks for a previously accepted idempotency result, then locks affected products in ID order. It verifies the revision/fingerprint and commits stock reservation, an order with immutable snapshots, cart clearing/revision advancement, the idempotency result and outbox event together. Any validation failure rolls back everything and leaves the cart intact.

```mermaid
stateDiagram-v2
  [*] --> accepted: checkout transaction commits
  accepted --> fulfilled: fulfillment.completed
  accepted --> failed: fulfillment.failed + stock compensation
  fulfilled --> [*]
  failed --> [*]
```

Duplicate events are recorded in the owning inbox within the same transaction as their effects. A new event ID with a contradictory terminal outcome cannot reverse the order. Stock is released only during the accepted-to-failed transition. A recovery cart copies historical quantities into a new anonymous shopper cart, then uses current prices and availability at preview/acceptance.

```mermaid
stateDiagram-v2
  [*] --> queued: accepted event committed with job
  queued --> processing: attempt persisted
  processing --> completed: successful simulation
  processing --> retry_wait: processing failure with budget remaining
  retry_wait --> processing: durable retry deadline reached
  processing --> failed: third processing failure
```

Presets are success, slow (five seconds), retry (first attempt fails, second succeeds), and fail (three failures). A job snapshots its preset. Retry delays are one and five seconds. Connectivity failures pause progress without spending another processing attempt. Pausing finishes an already active attempt, then starts no new attempts. Immediate termination leaves persisted attempts/deadlines available for recovery. A settings-row lock and a unique partial attempt index enforce one active attempt.

## Events and identifiers

The [system replacement guide](replacing-systems.md) identifies the existing seams and required guarantees. Event creation/outbox staging are transport-independent; application entry points choose the delivery adapter. A shopper-scoped `submissionReference` connects a checkout key to events, persisted jobs and outcomes without distributing its raw replay key.

| Event                 | Producer    | Version-one payload                 |
| --------------------- | ----------- | ----------------------------------- |
| order.accepted        | Ordering    | orderId                             |
| fulfillment.completed | Fulfillment | orderId, fulfillmentId              |
| fulfillment.failed    | Fulfillment | orderId, fulfillmentId, failureCode |

All envelopes include id, type, schemaVersion, occurredAt, correlationId and causationId. Repeated publication retains the original event ID. Consumer effects commit before acknowledgment. Durable queues, persistent messages, routing checks and publisher confirmations provide at-least-once delivery; application transactions and deduplication handle repeated delivery. Invalid or wrong-owner contracts enter lab.quarantine with diagnostic activity.

An entity ID identifies a record; an event ID identifies a fact; a request ID identifies one HTTP attempt; a correlation ID ties together the journey; an idempotency key identifies one confirmed checkout submission. A new HTTP retry has its own request ID but retains the submission/key and correlation context. IDs appear in drill-down records and activity, never aggregate metric labels.

Server timestamps use UTC ISO 8601; PostgreSQL stores timestamptz. createdAt/updatedAt describe mutable records, accepted-order creation records acceptance, fulfilledAt/failedAt describe terminal outcomes, attempt startedAt/dueAt/finishedAt support restart, and outbox createdAt/publishedAt describe delivery. respondedAt and sampledAt identify observations rather than business occurrence.

## Exceptions and important limits

Problem Details responses contain a stable code, HTTP status, human-readable detail, request/correlation identifiers, response time and applicable field/item details. Invalid input is a client error; stale cart/prices, stock shortages and conflicting idempotency submissions are conflicts; dependency outages are unavailable responses. An ambiguous checkout response preserves the saved submission for explicit recovery.

Group 1 supports up to 50 distinct cart products and quantities 1–999. Prices/stock adjustments have bounded request values; currency is USD and amounts are integer cents. Historical product references survive deactivation. Lists and record panels are intentionally small; this is a learning lab, not a high-volume storefront. Process metrics reset on restart; durable records provide lifecycle history. The repository also implements a revisioned Redis catalog cache, simulated shoppers and nine scoped failure exercises. Telemetry history storage, repeatable load reporting, SFTP/batch ingestion, additional database models and Kubernetes remain future work.

## Decision register

| Decision                                                 | Reason                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Node 24 / pnpm / TypeScript                              | One reproducible language/toolchain across the four applications                           |
| Fastify / TypeBox / Ajv                                  | Small REST implementation with executable request/response contracts                       |
| PostgreSQL, two databases                                | Teach ownership and local transactions without cross-service table reads                   |
| RabbitMQ                                                 | Durable queues and explicit publication/acknowledgment behavior with modest local overhead |
| Transactional outbox/inbox                               | Database commit and broker acknowledgment cannot be one distributed transaction            |
| Native applications locally, containers for dependencies | Current split: three native backend owners; dependencies in a dedicated guest              |
| Next.js / Tailwind / shadcn-style controls               | Simple shop/catalog/dashboard navigation with shared accessible controls                   |
| Manual restart after crashes                             | Keep requested and observed state explicit; no hidden restart policy                       |
| Preserve existing volumes when moving API processes      | Process placement changes do not require erasing business records                          |
