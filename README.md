# eCommerce full-stack learning ecosystem

[![Code quality](https://github.com/dehanz13/eCommerce-distributed-system-lab/actions/workflows/quality.yml/badge.svg)](https://github.com/dehanz13/eCommerce-distributed-system-lab/actions/workflows/quality.yml)
![Measured unit coverage](docs/badges/unit-coverage.svg)

Local learning monorepo: web, ordering, fulfillment, and operator. PostgreSQL stores two separately owned databases; RabbitMQ delivers durable events, Redis caches revisioned catalog reads, and a scoped AMQP proxy supports network exercises. Fictional data only. The single-machine learning core runs locally. See [current verification](docs/learning-labs-verification.md) for exactly what was tested and what remains unverified.

## Run locally

Install Docker with Compose, Node 24 and pnpm 10.21.0. From this repository, select Node with `nvm use`, then run `pnpm install --frozen-lockfile`. Copy `.env.example` to `.env` if needed and review its ports/hosts. `./lab operator` boots the control service; `./lab start` starts dependencies, migrates/seeds the databases and starts the applications. `./lab` opens the terminal menu. Shop: http://localhost:4310, catalog: http://localhost:4310/catalog, system dashboard: http://localhost:4310/system. `./lab stop` stops the managed lab services; `./lab reset` erases and reseeds lab data.

The canonical editable configuration is the ignored root `.env`. Do not copy running process IDs or generated runtime state between machines. Stop older processes before starting another checkout on the same ports.

`develop` is the integration/default branch. Release work is reviewed on a separate branch before merging; the first release candidate is `release/0.1.0-learning-core`. See [the branch and release workflow](docs/git-workflow.md).

## Shutdown and free resources

Follow the [shutdown, cleanup and restart runbook](docs/shutdown-and-cleanup.md) for M3 and the dedicated MBP19 guest. It covers stopping the operator, preserving database records, checking that services stopped, removing rebuildable files, optional data/VM deletion, and starting again. `./lab stop` leaves the operator running; `./lab reset` erases data and starts the lab again.

## Repository guidance

Your root instruction documents apply to every leaf folder. Root Markdown, text, PDF, DOCX and AsciiDoc instruction documents are ignored by Git, with exceptions for this README, CHANGELOG and LICENSE. Local AGENTS.md tells assistants to read the user-maintained root guidance first. Keep shared onboarding/design documentation under docs/ so it can be committed. Ignore rules do not untrack files previously committed.

## Quality and monitoring

`pnpm quality` checks types, lint, formatting and measured unit coverage; `pnpm build` builds the frontend. `pnpm test:integration` and `pnpm test:e2e` exercise the running lab. `./lab monitor` opens btop for the current machine. See [quality, GitHub badges and host monitoring](docs/code-quality.md) for scope, badge setup and VM measurement details. The displayed percentage is a measured local unit-test baseline, not a general correctness score or a live GitHub result.

Start learning with [architecture and decisions](docs/architecture.md), [ontology and all 17 learning goals](docs/ontology-and-learning.md), and [local/two-machine operations](docs/operations.md). Run `./lab test-browser` for the isolated Linux browser suite when native browser launch is restricted.

The System Dashboard now includes an Architecture tab with the ownership map, observed checkout hops, replay, service health and planned additions. Run a demo checkout there, or observe orders submitted from Shop. See [the architecture dashboard guide](docs/architecture-dashboard.md) for observation guarantees and extension points.

The dashboard also includes **Cache**, **Shoppers**, and **Failure Lab** views. See [guided exercises and contracts](docs/learning-labs.md) and [the dedicated MBP19 VM runbook](docs/mbp19-lab-vm.md). Use `pnpm test:learning` to verify all nine named fault controls against the running lab. `./lab reload-operator` reloads the operator explicitly after source/config changes; restart web separately to rebuild its interface.
