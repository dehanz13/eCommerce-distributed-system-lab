# Command reference

Run from the checkout root. The [learning path](learning-path.md) provides ordered exercises and expected outcomes; this reference enumerates shipped entry points. Root `.env` controls origins/topology; examples assume `.env.example` defaults. Scripts do not imply successful readiness until their result says so. Do not run destructive/fault tests on another project's services.

## Terminal launcher

| Command                                     | Parameters and behavior                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `./lab`                                     | Interactive menu: start, status, monitor, pause, resume, preset, restart, stop, seed, reset, exit. Exit leaves processes running. |
| `./lab operator`                            | Start/check the operator and print its origin.                                                                                    |
| `./lab reload-operator`                     | Reload only the operator; retain other processes/records.                                                                         |
| `./lab start`                               | Start dependencies and owner/web processes, migrations and seed.                                                                  |
| `./lab start SERVICE`                       | Start one named service.                                                                                                          |
| `./lab stop`                                | Immediately stop managed systems; keep operator to retrieve action result.                                                        |
| `./lab stop SERVICE`                        | Stop one named service.                                                                                                           |
| `./lab restart SERVICE`                     | Immediate stop/start; web rebuilds. A service is required.                                                                        |
| `./lab status`                              | Observed readiness; does not restart a crashed service.                                                                           |
| `./lab seed`                                | Seed an empty catalog; preserve an existing one.                                                                                  |
| `./lab reset`                               | Erase lab-managed data/queues/logs/state, then recreate and reseed; configuration retained.                                       |
| `./lab pause` / `./lab resume`              | Finish an active attempt before pausing new processing / resume processing.                                                       |
| `./lab preset fulfillment PRESET`           | `success`, `slow`, `retry`, `fail`; affects new jobs. The positional `fulfillment` is required by the current direct launcher.    |
| `./lab feeder`                              | Start defaults: shoppers 30, concurrency 4, seed 42, thinkMs 300. Custom parameters use the HTTP endpoint below.                  |
| `./lab feeder status` / `./lab feeder stop` | Inspect / prevent new shoppers and finish active journeys.                                                                        |
| `./lab experiment SCENARIO SECONDS`         | One fault, 3–30 seconds; default without parameters is cache-outage for 12 seconds.                                               |
| `./lab experiment status`                   | Inspect the run; completion/restoration are asynchronous.                                                                         |
| `./lab monitor`                             | btop on current host.                                                                                                             |
| `./lab monitor remote-host`                 | btop on physical remote host over SSH. Requires REMOTE_HOST/REMOTE_USER.                                                          |
| `./lab monitor lab-vm`                      | btop inside configured guest; also requires REMOTE_VM.                                                                            |
| `./lab test-browser`                        | Run pinned Docker browser verification against running lab; optional image/build.                                                 |

`SERVICE`: web, ordering, fulfillment, postgres, rabbitmq, redis, toxiproxy. The operator bootstrap/reload commands are separate. Named HTTP lifecycle actions do not target operator itself. There is no generic command that safely deletes arbitrary resources.

`SCENARIO`: cache-outage, broker-outage, database-outage, fulfillment-restart, network-latency, network-cut, slow-processing, retry-processing, failed-processing. Restore is an HTTP action, not a shipped `./lab experiment restore` command. Inspect a failed/pending action before resubmitting it. CLI action polling has a three-minute deadline; it does not cancel an action when that deadline expires.

## Executable scripts and direct tools

| Entry point                          | Purpose / options                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./scripts/bootstrap`                | Check Node 24, create missing .env from example, install lockfile, operator and full startup. Review configuration first.                                |
| `./scripts/cleanup-startup`          | Stop listeners belonging to this checkout on default ports 4310–4313; custom ports require explicit ownership inspection.                                |
| `./scripts/monitor`                  | Run installed btop; forwards btop arguments. `./scripts/monitor --help` lists installed btop flags.                                                      |
| `./scripts/security-check`           | Publication policy, locked dependency advisories and redacted Git-history secret scan; requires gitleaks.                                                |
| `pnpm exec tsx tools/vm-template.ts` | Generate ignored private guest YAML from required root remote settings; does not create a VM.                                                            |
| `pnpm exec tsx tools/migrate.ts`     | Apply both owners' migrations to configured PostgreSQL; usually called by startup.                                                                       |
| `pnpm exec tsx tools/seed.ts`        | Seed an empty ordering catalog; usually called by seed/startup.                                                                                          |
| `node tools/coverage-badge.mjs`      | Read an existing coverage summary; regenerate business/overall badges and per-system reports; enforce business gate. Normally use test:coverage instead. |
| `node tools/image-audit.mjs`         | Run pinned image advisory checks; see security:images and its prerequisites.                                                                             |

`infrastructure/init-db.sh` is PostgreSQL first-volume initialization, called by the container entrypoint. It is not a general-purpose developer command and does not alter existing initialized owner credentials. Raw application entrypoints (`apps/*/src/main.ts`) are exposed by `pnpm dev:*` below.

## Every root package command

| Command                 | Behavior                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `pnpm check`            | Typecheck, ESLint and unit tests (without coverage).                                |
| `pnpm typecheck`        | Strict TypeScript validation.                                                       |
| `pnpm lint`             | ESLint; zero warnings permitted.                                                    |
| `pnpm format`           | Rewrite formatting; inspect diff before committing.                                 |
| `pnpm format:check`     | Verify formatting only.                                                             |
| `pnpm test`             | Vitest unit/module tests.                                                           |
| `pnpm test:coverage`    | V8 full-scope HTML/LCOV/JSON, per-system report, business gate and both SVG badges. |
| `pnpm quality`          | Typecheck → lint → format:check → test:coverage.                                    |
| `pnpm build`            | Production Next.js build.                                                           |
| `pnpm dev:web`          | Next development server, default local port 4310.                                   |
| `pnpm dev:ordering`     | Start ordering directly with current configuration.                                 |
| `pnpm dev:fulfillment`  | Start fulfillment directly.                                                         |
| `pnpm dev:operator`     | Start operator directly.                                                            |
| `pnpm openapi`          | Export contracts from running owners and local event schema into docs/contracts.    |
| `pnpm check:public`     | Check tracked/new nonignored files against repository publication policy.           |
| `pnpm security`         | Run security-check script; result is separate from coverage.                        |
| `pnpm security:images`  | Container advisory scan; inspect recorded findings, not just a badge.               |
| `pnpm monitor`          | Local btop helper.                                                                  |
| `pnpm test:integration` | Real owner CRUD/checkout/concurrency/event checks against a disposable running lab. |
| `pnpm test:recovery`    | Crash/dependency/recovery checks; interrupts lab services.                          |
| `pnpm test:learning`    | Cache/traffic/fault controls against a disposable lab.                              |
| `pnpm test:e2e`         | Seeded browser journeys; install Chromium first.                                    |

Useful test parameters:

```sh
pnpm exec vitest run tests/checkout.test.ts
pnpm exec vitest run tests/fulfillment.test.ts
pnpm exec vitest run tests/feeder.test.ts tests/experiments.test.ts
pnpm exec vitest run --coverage
pnpm exec playwright install chromium
# Ubuntu CI/host if system browser dependencies are missing:
pnpm exec playwright install --with-deps chromium
pnpm exec playwright test --list
pnpm exec playwright test --headed
```

`vitest run --coverage` alone collects data; `pnpm test:coverage` additionally enforces the business gate and produces system reports. Browser suites require a running disposable lab and change its global settings. Run integration/recovery/learning/browser sequentially. The web package additionally exposes `pnpm --filter @lab/web dev`, `build`, and `start`; `start` requires an existing production build. Managed `./lab start` is preferred to mixing duplicate processes.

## Operator HTTP controls and parameterized traffic

Shell helpers on the application host:

```sh
OPERATOR=http://127.0.0.1:4313
ORDERING=http://127.0.0.1:4311
FULFILLMENT=http://127.0.0.1:4312
# Start custom traffic: shoppers 1–500; concurrency 1–20;
# seed 1–2147483647; thinkMs 0–2000.
curl --fail-with-body -sS "$OPERATOR/api/v1/feeder" \
  -H 'Content-Type: application/json' \
  -d '{"shoppers":60,"concurrency":6,"seed":42,"thinkMs":300}' | jq
# Choose one of the nine scenarios; durationSeconds 3–30.
curl --fail-with-body -sS "$OPERATOR/api/v1/experiments" \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"network-cut","durationSeconds":12}' | jq
# Explicit restoration after a finished/interrupted exercise:
curl --fail-with-body -sS -X POST "$OPERATOR/api/v1/experiments/restore" | jq
# Named lifecycle action: name required; omit service for the entire lab;
# preset required for preset action. Omit unused fields.
ACTION=$(curl --fail-with-body -sS "$OPERATOR/api/v1/actions" \
  -H 'Content-Type: application/json' -d '{"name":"restart","service":"ordering"}' | jq -er '.data.id')
curl --fail-with-body -sS "$OPERATOR/api/v1/actions/$ACTION" | jq
```

Do not run these examples as one batch: traffic/fault runs are asynchronous and can block lifecycle mutations. Start a fault before traffic if studying both together. A response returning an action/run ID is submission evidence, not completion. Inspect its terminal state and restoration.

## REST capability inventory

The tables below come from committed owner OpenAPI paths. `:id`/`:productId` are UUIDs; body schemas are listed in docs/contracts. Servers assign authoritative timestamps. Success responses wrap data with request/correlation IDs and response time. Errors use Problem Details with stable application codes. `pnpm openapi` refreshes exports against running owners; it does not prove every behavior.

### Ordering

| Method | Path                                   | Required input                                                                            |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/metrics`                             | None                                                                                      |
| GET    | `/activity`                            | None                                                                                      |
| GET    | `/openapi.json`                        | None                                                                                      |
| GET    | `/health`                              | None                                                                                      |
| GET    | `/api/v1/products`                     | None                                                                                      |
| POST   | `/api/v1/products`                     | body: name, description, priceCents, availableStock                                       |
| GET    | `/api/v1/products/{id}`                | path: id (required)                                                                       |
| PATCH  | `/api/v1/products/{id}`                | path: id (required); body: name (optional), description (optional), priceCents (optional) |
| DELETE | `/api/v1/products/{id}`                | path: id (required)                                                                       |
| POST   | `/api/v1/products/{id}/stock`          | path: id (required); body: delta                                                          |
| POST   | `/api/v1/carts`                        | body: shopperId                                                                           |
| GET    | `/api/v1/carts/{id}`                   | path: id (required)                                                                       |
| PUT    | `/api/v1/carts/{id}/items/{productId}` | path: id (required); path: productId (required); body: quantity                           |
| DELETE | `/api/v1/carts/{id}/items/{productId}` | path: id (required); path: productId (required)                                           |
| GET    | `/api/v1/carts/{id}/preview`           | path: id (required)                                                                       |
| POST   | `/api/v1/checkouts`                    | header: idempotency-key (required, ≤120 chars); body: cartId, revision, priceFingerprint  |
| GET    | `/api/v1/orders`                       | query: shopperId (optional)                                                               |
| GET    | `/api/v1/orders/{id}`                  | path: id (required)                                                                       |
| POST   | `/api/v1/orders/{id}/recover`          | path: id (required)                                                                       |
| GET    | `/api/v1/system`                       | None                                                                                      |
| GET    | `/api/v1/cache`                        | None                                                                                      |
| POST   | `/api/v1/cache/clear`                  | None                                                                                      |
| POST   | `/api/v1/cache/actions`                | body: action                                                                              |

### Fulfillment

| Method | Path                | Required input                             |
| ------ | ------------------- | ------------------------------------------ |
| GET    | `/metrics`          | None                                       |
| GET    | `/activity`         | None                                       |
| GET    | `/openapi.json`     | None                                       |
| GET    | `/health`           | None                                       |
| GET    | `/api/v1/system`    | None                                       |
| GET    | `/api/v1/jobs/{id}` | path: id (required)                        |
| PUT    | `/api/v1/settings`  | body: preset (optional), paused (optional) |

### Operator

| Method | Path                          | Required input                                     |
| ------ | ----------------------------- | -------------------------------------------------- |
| GET    | `/metrics`                    | None                                               |
| GET    | `/activity`                   | None                                               |
| GET    | `/openapi.json`               | None                                               |
| GET    | `/health`                     | None                                               |
| GET    | `/api/v1/status`              | None                                               |
| GET    | `/api/v1/resources`           | None; returns the stored stop-phase report or null |
| GET    | `/api/v1/activity`            | query: correlationId (optional UUID)               |
| POST   | `/api/v1/actions`             | body: name, service (optional), preset (optional)  |
| GET    | `/api/v1/actions`             | None                                               |
| GET    | `/api/v1/actions/{id}`        | path: id (required)                                |
| GET    | `/api/v1/broker`              | None                                               |
| GET    | `/api/v1/host`                | None                                               |
| GET    | `/api/v1/feeder`              | None                                               |
| POST   | `/api/v1/feeder`              | body: shoppers, concurrency, seed, thinkMs         |
| POST   | `/api/v1/feeder/stop`         | None                                               |
| POST   | `/api/v1/feeder/recover/{id}` | path: id (required)                                |
| GET    | `/api/v1/experiments`         | None                                               |
| POST   | `/api/v1/experiments`         | body: scenario, durationSeconds                    |
| POST   | `/api/v1/experiments/restore` | None                                               |

Action inputs reject unknown fields and invalid combinations. `start`, `stop` and `restart` accept an optional named service. `seed`, `reset` and `poweroff` operate on the lab and reject `service`. `pause` and `resume` accept only fulfillment as an optional service. `preset` requires a preset (`success`, `slow`, `retry`, `fail`) and accepts only fulfillment as an optional service. A 202 response means accepted for execution; inspect the action ID for its outcome.

## Infrastructure inspection and capacity controls

See [capacity guide](resource-capacity.md) for the execution host and full resize/update examples. Available controls include `limactl edit --cpus=N --memory=GiB --disk=GiB INSTANCE`, persistent Compose `cpus`/`mem_limit`, temporary `docker update --cpus --memory --memory-swap`, Redis `CONFIG SET maxmemory`, and all four feeder parameters. A generated YAML is configuration, not a running guest.

```sh
# Physical remote host:
limactl list
limactl start ecommerce-lab
limactl stop ecommerce-lab
limactl shell ecommerce-lab btop
# Local Docker engine in single topology:
docker compose --env-file .env ps -a
docker compose --env-file .env stats --no-stream
docker compose --env-file .env logs --tail=100 postgres rabbitmq redis toxiproxy
# Read-only PostgreSQL example; configuration is inherited from the container:
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$ORDERING_DB" -c "SELECT status,count(*) FROM orders GROUP BY status"'
```

Readiness and metrics: each owner has `/health`, `/metrics`, `/activity`, `/openapi.json`; ordering and fulfillment expose `/api/v1/system`. Operator `/api/v1/status`, `/api/v1/host` and `/api/v1/broker` observe named lab systems. Correlated activity uses `?correlationId=UUID`. `/metrics` returns JSON measurements, not a telemetry database.

Shutdown and deletion commands, including `docker compose ... down`, `down --volumes`, `limactl delete ecommerce-lab`, generated-file cleanup and restart, are spelled out with consequences in [shutdown and cleanup](shutdown-and-cleanup.md). Deletion is deliberate; no global prune command is part of this lab.

## Observation and cleanup controls

Full-lab restart is `./lab restart`. To stop the configured dedicated guest as well, use `./lab poweroff`; full `./lab start` starts it again. `./lab resources` reads the last cleanup report without starting anything. The operator's printed origin serves an independent control page. Additional reads: `GET /api/v1/resources` and `GET /api/v1/activity?correlationId=<uuid>`. These are bounded observations with timestamps and availability markers.

`pnpm test` and `pnpm test:coverage` regenerate the complete [test inventory](test-inventory.md). `pnpm test:inventory` regenerates from the latest private result file. Detailed workflow and retained-resource semantics: [observation guide](runtime-observation.md).
