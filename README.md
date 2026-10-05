# eCommerce distributed systems lab

The current independent setup runs shopper web on the client and the three APIs on the backend host, with dependencies in its dedicated guest. Follow [independent development](docs/independent-development.md) and the [eight Excalidraw architecture drawings](docs/diagrams/README.md). Coverage and verification evidence are reported separately in [code quality](docs/code-quality.md) and [local verification](docs/local-verification.md).

[![Code quality](https://github.com/dehanz13/eCommerce-distributed-system-lab/actions/workflows/quality.yml/badge.svg)](https://github.com/dehanz13/eCommerce-distributed-system-lab/actions/workflows/quality.yml)
[![Business line coverage](docs/badges/business-coverage.svg)](docs/coverage-report.md)
[![Overall unit line coverage](docs/badges/unit-coverage.svg)](docs/coverage-report.md)

A local monorepo with four applications: web, ordering, fulfillment and operator. Ordering and fulfillment own separate PostgreSQL databases. RabbitMQ carries checkout and fulfillment events. Redis caches catalog reads. Toxiproxy introduces scoped AMQP interruptions for learning exercises. Seed records and simulated shopper traffic are fictional; there is no signup, payment or carrier integration.

## Start

To run web on one machine and foreground APIs on another, use [independent development, terminal logs and cleanup](docs/independent-development.md). The web-only configuration contains HTTP origins, without backend credentials.

The [dated verification report](docs/local-verification.md) records the published backend-host cutover, live failure/recovery checks and deployment boundaries.

Install the Node version in `.nvmrc`, pnpm 10.21.0 and Docker with Compose. Native lifecycle checks use lsof on macOS and ss from iproute2 on Linux. Run these commands from the repository root:

```sh
nvm install
nvm use
pnpm install --frozen-lockfile
cp .env.example .env # first setup only; preserve an existing file
./lab operator
./lab start
./lab status
```

The default pages are Shop at http://127.0.0.1:4310, Catalog Admin at http://127.0.0.1:4310/catalog and System Dashboard at http://127.0.0.1:4310/system. `./lab` opens the terminal menu. `./lab reload-operator` loads operator source or configuration changes; `./lab restart web` rebuilds the frontend.

The root `.env` is the editable configuration source. Missing or invalid required settings stop startup and print their names, the file to check and the example to compare. Values are omitted from configuration errors. Remote settings are required only for remote operations. See [configuration and troubleshooting](docs/configuration.md).

## Operate and inspect

The dashboard provides Overview, Architecture, Cache, Shoppers, Failure Lab, Records, Timeline, Metrics and Controls. Architecture follows recorded activity with two-second polling. Its progress indicates observed milestones, not network transit time or completion percentages for real processing work.

The independent [backend architecture console](docs/backend-console.md) is served by the operator at `/architecture` (default port 4313), with zoom, system selection, live observations and filtered logs. It remains available when the shopper web app is stopped.

`./lab stop` stops the managed services while leaving the operator available. `./lab reset` erases and reseeds managed lab data. Follow the [shutdown and cleanup runbook](docs/shutdown-and-cleanup.md) to stop the remaining operator, preserve or delete volumes, remove generated files and stop a dedicated guest. Run `./lab monitor` for local btop, `./lab monitor remote-host` for the remote physical host, or `./lab monitor lab-vm` for its configured guest.

## Documentation

For module replacement and end-to-end checkout identity, read [replacement seams and key references](docs/replacing-systems.md).

For future adoption and payments, read [reusable ecommerce API direction](docs/reusable-ecommerce-api.md). For changing persisted data and transport contracts, follow [the schema-change runbook](docs/schema-change-guide.md).

Start with the [step-by-step learning path](docs/learning-path.md). Keep the [complete command reference](docs/command-reference.md) alongside it, and use the [capacity guide](docs/resource-capacity.md) for CPU, memory, disk and shopper-traffic parameters. [Editable Excalidraw scenes and SVG diagrams](docs/diagrams/README.md) show the whole ecosystem, each data path and the dedicated guest.

| Topic                                                  | Reference                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Per-system tools, dependencies and infrastructure      | [Technology inventory](docs/tech-stack.md)                                |
| Ownership, transactions, events and state transitions  | [Architecture](docs/architecture.md)                                      |
| Records, commands, facts and observations              | [Ontology and learning map](docs/ontology-and-learning.md)                |
| Local and remote operation                             | [Operations](docs/operations.md), [remote guest](docs/remote-lab-vm.md)   |
| Recorded activity and animation limits                 | [Architecture dashboard](docs/architecture-dashboard.md)                  |
| Cache, shopper traffic and failure exercises           | [Learning labs](docs/learning-labs.md)                                    |
| Measured checks and their limits                       | [Verification](docs/verification.md), [security checks](docs/security.md) |
| Physical two-host deployment and resource observations | [Two-host verification](docs/two-host-verification.md)                    |
| Review and release process                             | [Git workflow](docs/git-workflow.md)                                      |

## Check changes

```sh
pnpm quality
pnpm build
pnpm security # requires gitleaks
```

With the disposable lab running, execute `pnpm test:integration`, `pnpm test:recovery`, `pnpm test:learning` and `pnpm test:e2e` sequentially. These suites change simulation settings and interrupt lab dependencies. CI runs them on an isolated Ubuntu runner. The [verification record](docs/verification.md) links results to specific commits and runs.

The business line gate is 91%. Overall coverage retains startup, HTTP assembly, UI and operational tools, including untested files. Both badges link to the [per-system report](docs/coverage-report.md); these are committed measurements, not general correctness percentages. [Quality and monitoring](docs/code-quality.md) explains the measured scope and report locations.

`develop` is the default integration branch. Release branches target it through pull requests. Configuration, key files, runtime state, generated results and personal root guidance are excluded by ignore rules. Shared documentation belongs under `docs/`; check staged files because ignore rules do not remove already tracked files.

Transaction logs, full-lab controls and cleanup evidence: [observation and control guide](docs/runtime-observation.md). Every collected unit/module test and its dated status: [test inventory](docs/test-inventory.md). Local root instruction documents, including `STANDARDS.md`, apply to all descendant folders and stay ignored.
