# Transaction observations, control and test evidence

Each application owns its business rules and records observations at its boundaries. The root `STANDARDS.md` is local guidance and remains ignored. This guide documents the shared behavior and verification commands.

## Read a transaction end to end

1. Start the operator and lab using the root configuration.

   ```sh
   ./lab operator
   ./lab start
   ```

2. Open **System Dashboard → Architecture** and run a demo checkout, or use **Shop** to submit one. Copy its correlation ID from the metadata.
3. Open **Timeline** and enter that ID. The browser records bounded input/transport/output locally. Owner logs record request input, validated processing, transaction statement/result steps, committed or rolled-back outcome, and response output. Broker records include event publication, received envelopes and acknowledgment. Fulfillment records its persisted attempt deadline, processing decision, retry delay and result.
4. Collect the bounded recent owner windows from the operator. Replace the placeholder with a valid UUID. Use the operator origin printed by `./lab operator`; the example uses the default port.

   ```sh
   curl --fail-with-body 'http://127.0.0.1:4313/api/v1/activity?correlationId=<uuid>'
   ```

5. Read `sources` before interpreting missing entries: unavailable sources have `available: false`. `exhaustive: false` and `limitPerOwner: 200` are explicit. Full retained files are local `.lab/logs/<owner>-<UTC-date>.ndjson` on the host that owns the process. The bounded endpoint reads at most 512 KiB from each of seven recent daily files, then returns at most 200 matching entries. A busy trace can exceed that window. Copy private log files locally if deeper investigation is needed; never commit them.

### How to interpret a stage

| Stage   | Meaning                                                                 | Useful metadata                                                                                    |
| ------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| input   | Data arrived or an attempt began                                        | Request/correlation/event/causation IDs, fictional body or envelope, job/attempt IDs               |
| process | Validation, statement execution, publication or simulated-work decision | Transaction ID, step number, statement, row count, destination queue, persisted deadline, duration |
| output  | Response, rejection, committed outcome or acknowledgment                | Status/code, response data, durable entity IDs, retry delay, compensation outcome                  |

SQL parameter values are not logged. Statements and row counts describe attempted processing, not a separate durable audit. A commit record follows successful commit; a rollback record identifies rejected work. Logging failures emit a terminal diagnostic without changing the business result. Authentication, configuration and idempotency secrets are redacted; arrays, depth and strings are bounded. Server-generated timestamps remain authoritative.

Successful health/status/metrics polling and empty processor ticks stay quiet. Meaningful catalog reads and business writes still log. Identical dependency errors are summarized at most once per 30 seconds by each loop/publisher, with suppressed counts; changes and recovery produce new observations. Metrics remain available while idle. PostgreSQL, Redis and RabbitMQ internals are not instrumented at every instruction: owner boundary observations and operational measurements are the available evidence. Current-browser observations are in memory, capped at 200 entries and cleared on reload; they are not a multi-browser archive.

## Operate and close the loop

**Controls** separates whole-lab scripts, individual commands, cleanup evidence, fulfillment settings and data operations. Buttons include command/script text, distinct styles and hover/focus help. The operator accepts allowlisted names, never arbitrary shell text.

| Command                                                          | Effect and retained resources                                                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `./lab operator`                                                 | Start the operator and print its independent control-page origin                                                                          |
| `./lab start`                                                    | Start the configured guest if applicable, deploy its projection, start dependencies, migrate/seed, start owners and web, check readiness  |
| `./lab restart`                                                  | Verify complete teardown, then start; preserve durable records                                                                            |
| `./lab stop`                                                     | Stop owned applications and remove this Compose project's containers/networks; preserve volumes, images, logs, VM allocation and operator |
| `./lab poweroff`                                                 | Stop the lab and configured dedicated Lima guest, local or remote; preserve its disk and operator                                         |
| `./lab resources`                                                | Read the saved cleanup report from disk without starting the operator                                                                     |
| `./lab start redis` / `./lab stop redis` / `./lab restart redis` | Operate only Redis; other service names: web, ordering, fulfillment, postgres, rabbitmq, toxiproxy                                        |
| `./lab status`                                                   | Probe readiness without starting stopped applications                                                                                     |
| `./lab pause` / `./lab resume`                                   | Persist fulfillment pause/resume; finish active attempts before pausing new work                                                          |
| `./lab preset fulfillment retry`                                 | Select newly recorded job behavior: success, slow, retry or fail                                                                          |
| `./lab seed`                                                     | Seed an empty catalog, preserving existing catalog records                                                                                |
| `./lab reset`                                                    | Explicitly erase lab data, queues, logs and state, then migrate/reseed                                                                    |

Open the operator origin in a separate browser tab **before stopping or restarting web/the entire lab**. Its control page stays available after the Next.js process stops. It provides full-lab and individual-service actions, readiness inspection, activity collection, action outcomes and cleanup evidence. Stopping the operator itself remains a terminal operation from the [shutdown runbook](shutdown-and-cleanup.md).

Active shopper runs/exercises block conflicting lifecycle actions. Stop shoppers and let the current bounded exercise restore before stopping the lab. Startup failures trigger cleanup of partial work. Cleanup continues across independently failing local services and Compose teardown; unavailable remote access does not certify remote shutdown. Whole-lab restart does not start again after unverified teardown. Immediate termination relies on durable job/event recovery. A named single-service action does not produce a whole-lab teardown report.

## Resource report interpretation

Use **Controls → Cleanup evidence**, the independent operator page, `./lab resources`, or the operator endpoint:

```sh
curl --fail-with-body http://127.0.0.1:4313/api/v1/resources
```

Reports contain before/after timestamps, host scope, source, memory/disk/load samples, stopped/remaining/unknown service observations, errors and retained-resource notes. Local application RSS is sampled with ownership-checked `ps`; unsupported readings are null. Remote host and guest readings use SSH and Python 3 OS counters. Missing Python/connectivity produces an unavailable sample rather than a zero.

Local Node `os.freemem()` is OS free memory. Remote Linux uses `MemAvailable`; remote macOS uses free plus inactive pages. They have different meanings: compare before/after within the same named scope and method, not as interchangeable host totals. A positive free-memory delta is an observed change; unrelated workloads and OS caches also change. `baselineRestored` is null because no comparable idle baseline has been certified. `verified` means targeted listeners/containers are observed stopped and required after-samples are available; it does not claim reclaimed disk space, peak usage or restored baseline. A restart's cleanup report describes its stop phase; the lab can already be running again when you read it.

Stopping containers leaves database volumes and images on disk. Stopping the guest releases its allocation while retaining its virtual disk. The operator, Docker runtime and unrelated guests/workloads can remain running. No global prune is executed. Use the explicit, scoped deletion instructions in the shutdown runbook if disk space must be reclaimed.

btop is an interactive companion measurement. Run `./lab monitor`, `./lab monitor remote-host`, and `./lab monitor lab-vm` for the corresponding scope while it is running. Capture actual readings with the same workload and timestamps; this report does not fabricate or label OS counters as btop output. See [capacity controls and parameters](resource-capacity.md).

## Test evidence

The [complete unit/module inventory](test-inventory.md) and [machine-readable inventory](test-inventory.json) are generated from Vitest assertion results. Checked boxes mean passed in the named run; unchecked boxes explicitly distinguish failed, skipped and pending. Collection failures have their own section. A dated snapshot is not a live status.

```sh
pnpm test
pnpm test:coverage
# Regenerate from the latest retained result file without executing tests again:
pnpm test:inventory
# Focused cases still use the underlying runner; these do not replace the full inventory:
pnpm exec vitest run tests/observation.test.ts tests/operator-lifecycle.test.ts
```

The runner removes the previous private result before execution, saves fresh output under `.lab/unit-results.json`, generates the inventory even after assertion failure, then returns the test exit code. Shared output uses relative paths and case statuses; private result files can contain local diagnostic paths and must remain ignored. CI uploads the generated checklist and coverage evidence, including failures. Business coverage retains the 91% line gate with separate overall/per-system reports.

Use good and bad fictional inputs at public boundaries. HTTP mocks simulate real external responses including unavailability/contract failure; process/SSH fixtures test allowlisted command behavior without touching machines. SQL tests apply real owner migrations to an in-memory PostgreSQL engine and verify rollback/deduplication. They do not establish real multi-connection locking, Docker teardown, remote resource release or live VM startup. Those require the isolated integration/browser checks and an explicitly observed remote demonstration. See [quality scope and limits](code-quality.md).
