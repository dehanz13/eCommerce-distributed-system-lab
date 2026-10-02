# Verification record

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
