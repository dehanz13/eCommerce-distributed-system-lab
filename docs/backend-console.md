# Backend architecture console

Open `http://<backend-host>:4313/architecture` after starting the operator on the backend machine. The operator serves this page and its JavaScript directly; it does not depend on Next.js, the shopper page, or a frontend build. The root operator page still provides Controls & recovery. Both pages link to each other. The console works with the existing managed topology or independently started owners, using configured owner origins.

Use zoom in/out or Fit diagram, and scroll or drag empty space to pan. Each system is a keyboard-accessible button. Select it to view its observed health, owner data/metrics, and recent logs. The shopper client appears outside the backend scope. PostgreSQL is one physical server with two owner databases. Dependency placement reflects configuration, not discovered host residency: in a guest topology, those dependencies can be in the configured guest. The page does not create or relocate systems.

Each box includes a short explanation of its value. Use Connections and Message bus to move within the same zoomable canvas. Fit diagram fits its width; scroll to inspect the complete ecosystem. The upper view shows physical HTTP, SQL, cache and AMQP connections. Two owned database objects sit inside the PostgreSQL server boundary. Each database's badge comes from its owning API's database connectivity probe; it can remain connected even when that API reports a broker problem. An unreachable API leaves its database state unknown.

The lower RabbitMQ view shows the same APIs in their producer and consumer roles, not extra processes:

| Producer            | Routing key / queue | Consumer              | Purpose                                                    |
| ------------------- | ------------------- | --------------------- | ---------------------------------------------------------- |
| Ordering API        | `lab.accepted`      | Fulfillment API       | Accepted purchases become resumable jobs                   |
| Fulfillment API     | `lab.outcomes`      | Ordering API          | Completed/failed processing updates the order once         |
| Either API consumer | `lab.quarantine`    | No automated consumer | Retain invalid or wrong-owner deliveries for investigation |

The [default direct exchange](https://www.rabbitmq.com/docs/exchanges) routes by queue name, using the automatic queue bindings. This lab uses `sendToQueue` and explicit acknowledgments, not broadcast fan-out. All AMQP connections travel through the fault proxy shown above. Quarantine paths explain forwarding to the named queue through this same exchange. Queue boxes display measured ready, unacknowledged and consumer counts. A missing queue has unknown counters; a broker outage makes them unavailable. Zero consumers is highlighted for work queues but is expected for quarantine. Counts do not prove successful processing or identify individual producer connections.

Two arrowheads identify bidirectional transport: request/result, publication/confirmation or delivery/acknowledgment. Routing from exchange to queue is one-way. Blue means a request/command, violet a response/acknowledgment, teal event delivery, and red a failed recorded hop. Health is separate from traffic color. The current hop's text includes its observation time, operation and correlation when available, so color is not the only cue.

## Recorded-hop replay

The console collects fast owner observations and replays one hop every 650 milliseconds. Only the current hop has moving marks; a steady color trail remains for 4.5 seconds. This deliberately slower display does not delay or resend any real request. Reduced-motion settings show the same sequential colors without moving marks.

New records are ordered by their UTC occurrence time, with explicit dependencies for matching request IDs, SQL step results and event publication/delivery IDs. Receipt precedes processing and acknowledgment for the same event; consumer completion does not wait for the publisher’s confirmation record. This establishes the order of available evidence, not a complete global order across hosts: missing observations, clock differences and records arriving in separate collection batches can still limit ordering. Physical proxy hops and logical exchange routes are explained from owner boundary records; they are not independently measured packet traces.

The replay excludes records older than ten seconds relative to the sampled snapshot. Observation IDs are processed once and bounded to 1,200; at most 300 hops wait for replay. If this limit is exceeded, the console reports omitted hops and points to owner logs. Identity input filters logs and future replay by exact correlation or submission reference; changing it clears the current replay. Pause, operator transport failure and closing the page cancel replay timers and clear queued frames. Recent-window collection remains bounded, not an exhaustive ledger.

## Evidence and limits

The console sequentially polls `GET /api/v1/backend` two seconds after each completed sample, with bounded request timeouts. That read-only endpoint gathers owner health, system state, metrics, cache state, lab broker queues, the lab fault proxy and bounded activity windows. It does not issue business writes, database queries or control commands. Missing endpoints are reported independently. Database health is inferred from each owning API's database probe; when an owner cannot be reached, its database health is unknown. A reachable broker management endpoint is labeled Reachable, not a proof of message delivery.

Pause freezes observations and labels them stale. Manual refresh can collect a sample while paused; the page keeps the stale label to make the paused state explicit. Operator failure preserves the last snapshot with a stale label. A successfully sampled dependency outage shows unavailable/degraded instead of retaining a green badge. Each endpoint records its own sample time. Host specifications/counters describe the operator host, including unrelated workloads; guest and per-container CPU/memory usage are explicitly unavailable. Runtime metrics expose only the counters already supplied by their owner.

Application logs come from the existing sanitized activity contract, at most 200 records per owner. The inspector displays at most 100 matching records, with optional exact correlation/submission-reference filtering. Error/warning filters classify explicit levels, HTTP status and recorded failure/retry/rejection types. They are diagnostic categories, not a claim about root cause or native logger severity. Only values are inserted with textContent; an external log string cannot become HTML.

Infrastructure selections show relevant owner interaction observations. Native container stdout is not collected by this page. To inspect the actual infrastructure output on its configured host/guest, use a separate terminal:

```sh
docker compose --env-file .env logs --follow --tail 100 postgres rabbitmq redis toxiproxy
```

For the dedicated guest, run Compose inside its mounted checkout with `.lab/remote.env`, as in the guest runbook. This viewer does not stop containers; Ctrl+C stops following. Local owner terminal alternatives remain `pnpm logs ordering`, `pnpm logs fulfillment`, and `pnpm logs operator`. Do not publish raw native logs without review: they do not go through the application observation sanitizer.

Closing the page cancels its current fetch and stops its timer. Each new sample replaces the previous in-memory view. If an owner becomes unavailable, its last collected log window remains visible with an unavailable-source label; at most 600 records are retained across owners, with no growing browser history. The existing retention and cleanup policies still apply to owner files. Nothing is automatically replayed or restarted by the console.

## Editable diagram and maintenance

Download the Excalidraw scene from the console, or open `docs/diagrams/08-backend-console.excalidraw` in Excalidraw. This is an editable static architecture drawing with embedded local technology symbols; it does not contain private configuration or live data. The live console uses a small SVG/HTML renderer rather than loading the full Excalidraw editor. Both use `tools/backend-map.json` for positions, labels and paths. After changing that registry, regenerate the scene with:

```sh
pnpm exec tsx tools/backend-diagram.ts
```

The scene follows [Excalidraw's JSON format](https://docs.excalidraw.com/docs/codebase/json-schema/). Icon provenance is in `docs/diagrams/icons/README.md`. New real systems need validated observations, a registry entry and meaningful health semantics; do not add a planned system as a running node.

The collector is `tools/backend-console-observations.ts`; the fixed page and browser module are `tools/backend-console-page.ts` and `tools/backend-console-browser.js`. Operator routes live in `apps/operator/src/inspection-routes.ts`; the public snapshot contract is BackendConsoleSnapshot in `packages/contracts/src/index.ts`. Tests exercise partial failure, redaction, contract serialization, independent HTML/assets, selection, zoom, filters, paused snapshots, outage states and responsive layout. The default Playwright operator project uses OPERATOR_URL, separately from the shopper project using WEB_URL. Physical LAN reachability still needs validation on your machines.
