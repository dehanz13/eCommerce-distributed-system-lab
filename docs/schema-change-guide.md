# Change a schema without losing the journey

This runbook covers the current PostgreSQL owners and HTTP/event contracts. Run host commands from the intended backend checkout, with its pinned Node version and private configuration. Use a disposable lab first. Do not reset durable data to apply a migration. The independent operator architecture console provides backend observation/log inspection; the shopper dashboard provides Records and Timeline.

## Find the pieces that describe the same data

Start with the owner, not the UI. Ordering owns products, carts, stock reservations, orders and checkout replay. Fulfillment owns jobs and attempts. Each owns its own inbox/outbox; neither may query the other's tables.

| Change surface             | Files and blocks to review                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP input/output          | `packages/contracts/src/index.ts`: request schemas, Product/Cart/Preview/Order schemas, Reply, `validateReply`; `packages/contracts/src/lifecycle.ts` for control/cleanup contracts                   |
| Event envelope/payload     | `packages/contracts/src/index.ts`: Event/DomainEvent, `parseEvent`; `packages/runtime/src/events.ts`: `event` and `saveEvent`                                                                         |
| Ordering persistence       | Append the next numbered file under `migrations/ordering/`; `apps/ordering/src/domain.ts`: cart/order/preview/checkout/consume; `apps/ordering/src/main.ts`: catalog SQL, routes and system snapshots |
| Fulfillment persistence    | Append the next numbered file under `migrations/fulfillment/`; `apps/fulfillment/src/domain.ts`: consume/tick and attempt transitions; `apps/fulfillment/src/main.ts`: inspection/settings routes     |
| SQL-to-HTTP representation | `packages/runtime/src/rows.ts`: snake_case to camelCase, timestamps and total-cent conversion; keep new value conversions explicit                                                                    |
| Business invariants        | `apps/ordering/src/policies.ts`, `apps/fulfillment/src/policies.ts`; transaction locking and replay fingerprint in ordering domain                                                                    |
| Cache representation       | `apps/ordering/src/catalog-cache.ts`, cache routes in ordering main, `migrations/ordering/002.cjs` catalog revision trigger; verify old cache values are rejected or use a new representation version |
| Delivery                   | `packages/runtime/src/broker.ts`: publisher/consumer validation, routing and quarantine; keep durable outbox/inbox semantics                                                                          |
| Shopper presentation       | `apps/web/components/lab.tsx`, `checkout-recovery-dialog.tsx`; retained `lab.checkout` in browser storage must remain recoverable                                                                     |
| Diagram and logs           | `apps/web/lib/architecture-flow.ts`, `components/architecture.tsx`, `packages/contracts/src/observation.ts`, runtime observation/telemetry, `tools/activity-collection.ts`                            |
| Other clients/fixtures     | `packages/client/src/index.ts`; browser fixtures; `tools/feeder.ts`, `shopper-behavior.ts`, seed script and integration fixtures                                                                      |
| Exported contracts         | Regenerate `docs/contracts/*.openapi.json` and `events.schema.json` with `pnpm openapi` against updated running owners                                                                                |
| Documentation              | Architecture, replacement guarantees, configuration and this guide; update generated test inventory/coverage through their commands                                                                   |

This is a review map, not a requirement to edit every file. Trace each changed field from producer to every consumer using `rg -n 'field_name|fieldName' apps packages tools tests migrations docs/contracts`. Check both SQL and transport spellings. Route handlers validate inputs; the domain establishes the rules; JSX should not invent business state.

## Choose compatibility before writing SQL

1. Write the expected request, response and event examples, including old records without the new field. Identify all consumers, stored replay responses, retained browser submissions and queued envelopes.
2. For an additive field, first allow its absence and preserve existing behavior. Adding a field can still break older strict validators. Current events use schemaVersion 1: a breaking payload requires an explicit new version and readers for queued old envelopes, not merely changing the number.
3. Never edit an already applied migration. Add the next unused numbered owner migration (003 already adds submission_reference). Write pragmatic up/down comments explaining owner, input source, data retention and communication. A down migration that drops data is not a safe operational rollback.
4. Use expand, backfill, then contract for required fields or renames: add nullable/new storage; deploy compatible reads/writes; backfill in bounded batches; verify; add constraints/drop obsolete storage only after old callers and queued work are gone. Keep historical prices and accepted checkout bodies immutable.
5. Do not blindly regenerate submission references for historical orders. The raw replay key is private and scoped by shopper; current nullable historical references intentionally mean unavailable.

## Apply on the intended backend host

Keep the old source revision and a database backup before a destructive schema change. A migration rollback and a source rollback are separate decisions. With manually started owners, stop their terminals using Ctrl+C and inspect their shutdown receipts; leave PostgreSQL available. With the managed lab, use its named stop controls and inspect reports. Do not overlap manual and managed processes.

```sh
nvm use
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm exec tsx tools/migrate.ts
```

The runner applies both owner directories using their own database users and `migrations` tables. It is forward-only by default. For a guest, run it where the projected configuration and database addresses are reachable (see the guest runbook). Do not substitute a guessed database host.

For compatible rolling changes, upgrade readers before writers; update both checkouts' shared contracts. A stop-and-upgrade local lab is simpler, but still has old queued events, historical rows and saved browser submissions. Restart each manually started owner with its dev command, then restart/rebuild web when its contracts or compiled rewrites changed. Query names below must be adjusted if your new migration deliberately changes them.

## Read-only SQL validation

Connect separately to each owned database using its configured user. For local Compose, these commands open interactive psql without printing passwords; adapt the Compose invocation for the configured guest:

```sh
docker compose --env-file .env exec postgres sh -lc 'psql -U "$ORDERING_USER" -d "$ORDERING_DB"'
docker compose --env-file .env exec postgres sh -lc 'psql -U "$FULFILLMENT_USER" -d "$FULFILLMENT_DB"'
```

In either owner, confirm applied files, target columns and delivery backlog:

```sql
SELECT name, run_on FROM migrations ORDER BY id;
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
SELECT count(*) AS unpublished FROM outbox WHERE published_at IS NULL;
SELECT id, payload->>'type' AS event_type,
       payload->>'schemaVersion' AS version, published_at
FROM outbox ORDER BY created_at DESC LIMIT 20;
```

For the existing submission-reference change, inspect ordering:

```sql
SELECT id, status, total_cents, correlation_id, submission_reference
FROM orders ORDER BY created_at DESC LIMIT 20;
SELECT count(*) AS invalid_references FROM orders
WHERE submission_reference IS NOT NULL
  AND submission_reference !~ '^[a-f0-9]{64}$';
```

Then inspect fulfillment in its own psql session:

```sql
SELECT id, order_id, status, attempt_number, submission_reference
FROM jobs ORDER BY created_at DESC LIMIT 20;
SELECT job_id, attempt_number, status, failure_code, started_at, finished_at
FROM attempts ORDER BY started_at DESC LIMIT 20;
```

Old nullable references are expected. Zero unpublished events alone does not prove delivery; use the matching event ID in the receiving owner's inbox and its committed business record. Do not select raw idempotency keys or paste database responses/configuration into public evidence. Compare order/job identity manually rather than joining separate owner databases.

## Validate the complete journey

Run the updated owners, then the real-service suites from a checkout configured to reach them:

```sh
pnpm test:integration
pnpm test:recovery
pnpm test:learning
pnpm test:e2e
pnpm openapi
pnpm check:public
```

Open one terminal per owner or use `pnpm logs all <submission-reference>`. Trace `checkout.submitted`, `checkout.committed`/`checkout.recovered`, broker publication confirmation and consumer commit, `job.recorded`/`job.duplicate`, `attempt.started`, `attempt.finished`, and `outcome.applied`/duplicate. Read the actual outcome and event IDs; receipt or animation alone is not a durable commit. Use Timeline for browser HTTP failure and explicit recovery. Request/correlation IDs identify attempts; the submission reference joins replay correlations. These windows are bounded and gaps are possible.

### Observation metadata changes

Optional `streamId`, `sequence`, `publicationId` and `deliveryId` belong to `ActivitySchema` in `packages/contracts/src/index.ts`. The writer in `packages/runtime/src/observation.ts` supplies authoritative stream/sequence values; `packages/runtime/src/broker.ts` supplies transport identities and passes them through its consumer trace. `tools/backend-flow-order.js` and its declaration use that evidence for replay. Validate with the observation, broker-observation, HTTP-contract and backend-flow-order unit files plus the same-millisecond console browser case.

These fields do not change the durable event body or any SQL table, so this change needs no migration or reseeding. Restart the changed backend owners and operator independently, then regenerate owner OpenAPI exports. Verify matching publication/delivery IDs in `/activity` and the operator snapshot; compare sequence only within one process stream. Retained records lacking metadata and third-party transports without the optional header remain compatible, with limited causal ordering evidence.

Test old and new payloads, missing required values, validation/conflict responses, lost checkout response, explicit replay with its original body/key, duplicate event delivery, restart mid-attempt, dependency outage and eventual restoration. Expect one accepted order, at most one terminal outcome application and at most one stock compensation. Changed prices must require fresh confirmation, while an unresolved accepted submission must keep its original data.

If a consumer quarantines an envelope, inspect its validation code/version before changing the producer again. If migration fails, inspect that owner's applied migration table and constraints; don't reset the lab or assume both owners upgraded. If checkout recovery conflicts, compare the retained body with its original version privately; never generate a fresh key to conceal an unknown outcome. Record source revision, scope, commands, timestamps, failures, retained work and recovery steps in a private report under `.lab/reports/`.
