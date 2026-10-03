# Verification record

## Transaction observations and lifecycle controls

Local verification on October 3, 2026 UTC used Node 24.21.0, pnpm 10.21.0, Vitest 4.1.11 and the pinned lockfile. This is evidence for the observation/control changes on `release/0.3.0-observation-controls`; earlier entries below describe earlier source revisions.

| Check                                | Observed result                 | Scope                                                                                                                                                |
| ------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, ESLint, formatting       | Passed                          | Workspace source and generated reports                                                                                                               |
| Unit/module/contract checks          | 131 passed in 18 files          | Domain invariants, invalid controls, observation stages/redaction, bounded logging, collection availability, resource reports and lifecycle fixtures |
| Business line coverage               | 615/628, 97.92%                 | Explicit business scope; 91% gate                                                                                                                    |
| Overall line coverage                | 1056/2102, 50.23%               | Separate complete configured scope; per-system figures remain in the coverage report                                                                 |
| Production web build                 | Passed                          | Next.js 16.3.8                                                                                                                                       |
| Real transaction integration         | Passed                          | Concurrent checkout, cart preservation, replay/conflicts, terminal outcomes and compensation                                                         |
| Recovery suite                       | Passed                          | Lost response, durable attempt restart, duplicate delivery, broker and database outages                                                              |
| Learning integration                 | Passed                          | Catalog behavior and the nine named scenarios                                                                                                        |
| Browser journeys                     | 12 passed in 55.8 seconds       | Chromium in the pinned Linux browser image; local HTTP forwarded through Docker; shop, recovery, map replay, keyboard help and controls              |
| API export                           | Completed                       | Running ordering/fulfillment; current operator source on a temporary port, with malformed preset and misdirected poweroff requests observed rejected |
| Publication/dependency/history scans | Passed within configured scope  | No configured publication matches, no dependency advisories, no secret matches in reachable history; existing image findings remain separate         |
| Disposable teardown                  | Seven services observed stopped | Owned native listeners plus the isolated Compose project; operator retained for separate shutdown                                                    |

The browser run first exposed unavailable `crypto.randomUUID` on a local HTTP hostname and an excessively long replay after adding detailed SQL observations. A portable cryptographic ID fallback and replay of observed milestones resolved those failures. The final full browser run passed; failed attempts are not counted as passing runs.

Hosted security scanning subsequently found a newly reviewed `braces` advisory in the pinned linter's development dependency chain. The exact `typescript-eslint` pin was updated to 8.71.0 to remove that chain. Local audit, all 131 checks, quality and production build passed again at 01:13 UTC; coverage counts were unchanged. Hosted ecosystem and quality checks passed on the preceding application commit `95cc7d0`; the updated dependency commit needs its own checks. The initial local zero-advisory result above is a dated result, not a claim about later advisory data. See [the dependency record](security.md).

The [cleanup snapshot](cleanup-snapshot.json) was collected at 00:59:39.810 UTC in single-machine topology after these sequential suites. It records OS free memory changing from 93,732,864 to 156,106,752 bytes, a 62,373,888-byte increase. An earlier stop during this same session observed a 35,225,600-byte decrease. These are host observations under changing workloads, not measurements of memory exclusively reclaimed by the lab. Before-stop managed RSS was unavailable; after-stop owned application RSS was zero. No idle baseline was certified (`baselineRestored: null`). Volumes, images, logs, the Docker runtime and unrelated workloads remained allocated.

Remote guest startup/shutdown, unavailable remote hosts and cross-host cleanup were exercised through process/SSH fixtures, not a physical two-host deployment. No guest allocation was changed. No btop reading or remote capacity improvement is claimed. The resource guide provides commands for a separately observed demonstration. The root standards document remains local and ignored. CI results for the published revision must be inspected separately.

Recorded baseline: October 2, 2026, commit `1624320b700d7d8bca62ec63089fde636dc45afc`. [GitHub run 37046030584](https://github.com/dehanz13/eCommerce-distributed-system-lab/actions/runs/37046030584) completed at 18:18:11 UTC with both jobs successful. It used an isolated Ubuntu runner, Node 24.11.0 and the committed lockfile. This run predates the subsequent configuration and dependency update; inspect that update's checks separately.

| Check                             | Recorded result | Scope                                                                                                         |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| Type checking, ESLint, formatting | Passed          | Workspace source                                                                                              |
| Unit and contract tests           | 33 passed       | Validation, policies, shared contracts, wrapper, cache, feeder and lifecycle                                  |
| Frontend build                    | Passed          | Next.js production build                                                                                      |
| ShellCheck                        | Passed          | Committed executable helpers                                                                                  |
| Transaction integration           | Passed          | Stock competition, cart preservation, reconfirmation, replay, key conflict, terminal failure and compensation |
| Recovery suite                    | Passed          | Lost response, restart, duplicate delivery and dependency interruption                                        |
| Learning suite                    | Passed          | Catalog invalidation and nine named failure exercises                                                         |
| Browser suite                     | 11 passed       | Shop, recovery, architecture, cache, shoppers and scoped network exercise                                     |
| Shutdown                          | Passed          | Managed services stopped after the tests                                                                      |

## Configuration and dependency update

Local checks completed on October 2, 2026 at 19:05 UTC with Node 24.21.0, pnpm 10.21.0 and Vitest 4.1.11: 51 unit/contract tests across ten files passed, along with type checking, linting, formatting, production build and ShellCheck. The current-file policy checked 122 files with no configured matches; the npm audit reported zero advisories. Gitleaks 8.30.1 reported no configured secret matches in reachable history. These are local outcomes; the update's pull request records its separate CI results.

Measured unit coverage was 28.45% lines, 27.47% statements, 23.57% functions and 26.35% branches. The coverage provider changed with Vitest; values across tool versions are not directly comparable as a trend.

## Reproduce

```sh
pnpm quality
pnpm build
pnpm security
```

Start the disposable lab, then run integration, recovery, learning and browser suites sequentially. Each suite changes lab-owned state. The workflow source is `.github/workflows/quality.yml`; GitHub records the command outcomes for each commit.

## Resource evidence

`resource-snapshot.json` retains a single local observation from October 2, 2026 at 07:27:48 UTC. It records host, container and backend-process values from an earlier slice. It omits some current components and frontend/launcher overhead. It is neither a load benchmark nor evidence that the full lab fits an eight-GB budget.

For a new measurement, record topology, workload, timestamp and scope. Compare btop host/guest readings, `docker stats --no-stream`, and dashboard process metrics. Do not add guest allocation, container limits and host free memory as if they were independent capacity.

The runner result does not establish a complete remote interactive deployment, physical-host capacity, or every production failure mode. The nine exercise scenarios are a finite test set. Security scans have their own scope, tool version and advisory timestamp in [security checks](security.md).

## Learning guides and business coverage update

Local checks used Node 24.21.0, pnpm 10.21.0 and Vitest 4.1.11 with two unit workers. The measured business-module scope is explicit in `coverage-scope.mjs` and requires 91% lines. The [per-system report](coverage-report.md) and [per-file snapshot](coverage-snapshot.json) retain untested runtime, route assembly, JSX and terminal code in overall coverage.

The updated suite has 113 checks in 14 files. Checkout and fulfillment module tests execute the real owner migrations in PGlite 0.5.8. Tests include rollback after outgoing-event storage failure, accepted idempotency replay before empty-cart validation, conflicts, historical snapshots, duplicate/contradictory outcomes, compensation once, durable attempt resumption, retry deadlines/budget and dependency preservation. Fault-policy tests simulate named host operations; shopper tests exercise the real typed HTTP client against transport fixtures. Reporting tests reject below-gate or missing-module data and preserve separate overall/system figures.

Measured locally: business lines 581/594 (97.81%); business branches 92.84%; overall lines 809/1801 (44.91%). Baseline on the parent source with the same coverage engine was 512/1794 lines (28.53%). The overall denominator increased because the publication scanner now understands editable diagram metadata. Coverage is execution evidence, not a correctness score or a replacement for real multi-connection and broker tests.

TypeScript, lint, formatting, unit coverage and production web build passed locally. Locked installation succeeded with the exact PGlite addition. Dependency advisory and redacted Git-history secret scans reported no matches; public-file checks passed. Existing container-package findings remain documented in [security](security.md); no new clean-image claim is made.

Seven Excalidraw 0.18.1 scenes were restored after JSON serialization and exported with its SVG API. Scene element IDs and matching exports were checked; rendered layouts were visually inspected. The VM drawing distinguishes private host forwarding, container ports, owner databases, AMQP through Toxiproxy, SQL, cache and SSH controls. Capacity values shown are configured allocations. No physical-host or guest allocation was changed, and no new live resource benchmark was collected for this documentation/test change.

Real-server integration/recovery/browser results for this release belong to its fresh CI run. Earlier release results are not presented as validation of this revision. Tutorials describe fault/deletion commands for the named disposable lab; they were reviewed against shipped command handlers and owner contracts, not executed against either machine as a documentation check.
