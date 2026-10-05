# Technology inventory

Versions below come from the committed manifests, `.nvmrc` and container definitions. `pnpm-lock.yaml` records transitive dependency resolution. Backend applications and tools resolve their dependencies from the root manifest; web also has its own manifest. Private workspace packages export source capabilities rather than published domain libraries.

## Systems

| System               | Location         | Stack and direct capabilities                                                                      | Responsibility                                                                                                                             |
| -------------------- | ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Web                  | apps/web         | Next.js 16.3.8, React / React DOM 19.3.0, TypeScript 5.9.3                                         | Shop, catalog admin and system dashboard; HTTP proxy rewrites and browser-held anonymous identity.                                         |
| Ordering             | apps/ordering    | Node 24.21.0, shared HTTP/contracts, pg 8.23.1, amqplib 0.10.9, @redis/client 6.3.0                | Product/cart/order rules, checkout transaction, outbox/inbox and revisioned catalog cache.                                                 |
| Fulfillment          | apps/fulfillment | Node 24.21.0, shared HTTP/contracts, pg 8.23.1, amqplib 0.10.9                                     | Accepted-event consumer, durable jobs/attempts, retry deadlines and outcome outbox.                                                        |
| Operator             | apps/operator    | Node 24.21.0, shared HTTP/contracts and telemetry; native child_process, fs and fetch              | Named lifecycle actions, status, activity, shopper runs and scoped failure exercises. Requests owner APIs instead of reading their tables. |
| Terminal and helpers | tools, scripts   | tsx 4.20.6, @clack/prompts 0.11.0, node-pg-migrate 9.0.0; SSH, rsync, lsof / ss and Docker Compose | Terminal menu, migrations, seeding, process controls, remote projection, monitoring and contract export.                                   |

## Shared packages

| Package          | Dependencies or built-in capabilities                                                                          | Interface                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@lab/contracts` | TypeBox 0.34.41, Ajv 8.18.0, ajv-formats 3.0.1                                                                 | Request, response and event schemas; validation and transport types                                 |
| `@lab/client`    | `@lab/contracts`, native fetch, AbortSignal and performance timing                                             | Typed request wrapper, one transient read retry, explicit unknown write outcomes                    |
| `@lab/runtime`   | Fastify 5.12.5, @fastify/swagger 9.9.1, dotenv 17.2.3, pg 8.23.1, amqplib 0.10.9, @prometheus-io/client 0.16.1 | HTTP setup, configuration validation, database transactions, broker transport, metrics and activity |

The configuration export loads only file parsing and validation; frontend configuration does not initialize database, broker or metric clients. Ordering and fulfillment retain business decisions inside their own modules.

## Frontend dependencies

| Package                    | Version | Use                                                                  |
| -------------------------- | ------- | -------------------------------------------------------------------- |
| `@tailwindcss/postcss`     | 4.1.17  | Tailwind PostCSS integration                                         |
| `class-variance-authority` | 0.7.1   | Button variants                                                      |
| `clsx`                     | 2.1.1   | Conditional class composition                                        |
| `lucide-react`             | 0.553.0 | Icons                                                                |
| `next`                     | 16.3.8  | App Router, rendering, build and HTTP proxy rewrites                 |
| `radix-ui`                 | 1.4.3   | Slot composition for local button controls                           |
| `react`                    | 19.3.0  | Components and state                                                 |
| `react-dom`                | 19.3.0  | DOM rendering                                                        |
| `tailwind-merge`           | 3.3.1   | Resolve Tailwind class conflicts                                     |
| `tailwindcss`              | 4.1.17  | Utility CSS and theme styles                                         |
| `uuid`                     | 13.0.1  | Browser UUID generation, including ordinary HTTP development origins |

Local button/input components follow shadcn/ui composition patterns and are checked-in source. Runtime dependencies are Radix and the listed class utilities. Status forms, tables and native details elements remain ordinary application components.

## Backend and tooling dependencies

| Package                 | Version | Use                                                         |
| ----------------------- | ------- | ----------------------------------------------------------- |
| `@clack/prompts`        | 0.11.0  | Interactive terminal menu                                   |
| `@fastify/swagger`      | 9.9.1   | OpenAPI generation from registered schemas                  |
| `@prometheus-io/client` | 0.16.1  | Counters, gauges, histograms and process measurements       |
| `@redis/client`         | 6.3.0   | Ordering catalog-cache transport                            |
| `@sinclair/typebox`     | 0.34.41 | Executable JSON schemas and transport types                 |
| `ajv`                   | 8.18.0  | Schema validation                                           |
| `ajv-formats`           | 3.0.1   | UUID and date-time format checks                            |
| `amqplib`               | 0.10.9  | AMQP connections, confirmed publication and acknowledgments |
| `dotenv`                | 17.2.3  | Parse root and generated configuration files                |
| `fastify`               | 5.12.5  | HTTP services and route validation                          |
| `node-pg-migrate`       | 9.0.0   | Separate owner-database migrations                          |
| `pg`                    | 8.23.1  | PostgreSQL pools and explicit transactions                  |

## Infrastructure

| Component                   | Pinned reference                                                                                                     | Use                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `postgres`                  | `postgres:18.6-alpine3.24@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`                   | One PostgreSQL server, two owner databases; persistent volume                 |
| `rabbitmq`                  | `rabbitmq:4.2.9-management-alpine@sha256:97a167ef716a2c8799525d672c70896920c5415e2221418c0627603852dfcfb9`           | Durable AMQP queues and management API; persistent volume                     |
| `redis`                     | `redis:8-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0`                             | Revisioned catalog JSON; 15-second TTL, 96 MiB maxmemory, LRU, no persistence |
| `ghcr.io/shopify/toxiproxy` | `ghcr.io/shopify/toxiproxy:2.12.0@sha256:9378ed52a28bc50edc1350f936f518f31fa95f0d15917d6eb40b8e376d1a214e`           | Named AMQP proxy for latency and disconnect exercises                         |
| Node service base           | `node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`                 | Remote fulfillment image and Node layer for browser-test image                |
| Browser-test base           | `mcr.microsoft.com/playwright:v1.56.1-noble@sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a` | Chromium and test system libraries; Playwright package version must match     |

Docker and Compose are host prerequisites; their installed versions can differ between hosts. The Lima template pins guest installation packages and Ubuntu image digest in `infrastructure/ecommerce-lab.lima.yaml.template`. It uses Lima virtual machines and virtiofs mounts, with an explicitly configured SSH account and host address. Tailscale is optional private host connectivity configured outside the repository. Keys and generated host settings are not published.

## Development checks

| Tool or package             | Version                                            | Use                                                                          |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `@playwright/test`          | 1.56.1                                             | Seeded browser journeys with Chromium                                        |
| `@types/amqplib`            | 0.10.7                                             | AMQP TypeScript declarations                                                 |
| `@types/node`               | 24.10.0                                            | Node TypeScript declarations                                                 |
| `@types/pg`                 | 8.15.6                                             | PostgreSQL TypeScript declarations                                           |
| `@vitest/coverage-v8`       | 4.1.11                                             | V8 unit-coverage collection                                                  |
| `eslint`                    | 9.39.1                                             | Lint command                                                                 |
| `eslint-config-prettier`    | 10.1.8                                             | Disable formatting rules that conflict with Prettier                         |
| `eslint-plugin-jsx-a11y`    | 6.10.2                                             | JSX accessibility rules                                                      |
| `eslint-plugin-react-hooks` | 5.2.0                                              | Hook rules                                                                   |
| `prettier`                  | 3.6.2                                              | Formatting checks                                                            |
| `tsx`                       | 4.20.6                                             | Execute TypeScript service/tool/test entry points                            |
| `typescript`                | 5.9.3                                              | Strict static checking                                                       |
| `typescript-eslint`         | 8.71.0                                             | TypeScript lint rules                                                        |
| `vitest`                    | 4.1.11                                             | Unit and contract tests                                                      |
| `@types/react`              | 19.2.2                                             | Frontend TypeScript declarations                                             |
| `@types/react-dom`          | 19.2.2                                             | Frontend TypeScript declarations                                             |
| pnpm                        | 10.21.0                                            | Workspace installation and committed lockfile                                |
| ShellCheck                  | Host / runner installation                         | Executable shell checks                                                      |
| gitleaks                    | 8.30.1 pinned in CI                                | Redacted Git-history secret scan                                             |
| Trivy                       | 0.75.0 in the recorded scan                        | Container-package advisory scan; optional local tool                         |
| btop                        | Host installation; guest template pins its version | Interactive host or guest CPU, memory, process and supported device readings |

CI uses separate quality, ecosystem and security jobs. Coverage measures the configured unit-test scope; container scans are a separately timestamped audit, not part of that percentage. See [quality](code-quality.md), [security](security.md) and [verification](verification.md) for commands, recorded results and limits.

## Test-only database engine

PGlite 0.5.8 runs owner migrations and transactional domain checks in isolated unit fixtures. It is a development dependency, not a running backend service. Its single embedded connection does not establish real-server concurrency behavior; container integration checks retain that responsibility. Excalidraw 0.18.1 produced the editable documentation scenes and SVG exports; it is not an application runtime dependency.

## Documentation tooling and placement

Excalidraw 0.18.1 restores the eight editable scenes and exports their SVG references. Simple Icons 16.0.0 supplies locally embedded technology marks in their published colors; Toxiproxy uses its official README-linked mark. See [asset provenance](diagrams/icons/README.md). These are documentation tools/assets, not new backend services or runtime package dependencies. `tools/architecture-diagrams.mjs` describes the current implementation; `tools/backend-map.json` supplies the complete console ownership and broker registry.

The current physical split puts Next.js on the client, the three Node APIs on the backend macOS host, and PostgreSQL/RabbitMQ/Redis/Toxiproxy in its dedicated Ubuntu guest. PGlite remains test-only. See [drawing 07](diagrams/07-two-host-vm.svg) and [startup commands](independent-development.md).
