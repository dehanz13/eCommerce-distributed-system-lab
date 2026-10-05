# Run web and APIs independently

Web is a Next.js process, not the owner of ecommerce rules. Ordering and fulfillment are independent Node processes with separate databases. Operator provides inspection and named controls. Starting web does not start an API, database, broker or operator. An API outage leaves the page available and presents: “We’re having trouble connecting to the shop right now. Please try again shortly.” A pending checkout is retained for explicit recovery; availability polling never resubmits it.

## Client machine: web only

In this checkout, select the pinned Node version and install the locked dependencies. Create `.env.web` from the committed example and privately replace `backend-host.local` with the reachable backend machine hostname. Only ordering, fulfillment and operator HTTP origins belong in this file; no database, broker, SSH or payment credentials are needed.

```sh
nvm install
nvm use
pnpm install --frozen-lockfile
cp .env.web.example .env.web # first setup only
pnpm dev:web
```

Open http://127.0.0.1:4310. Next.js proxies browser-origin requests to the configured backend origins. Changing origins requires restarting development web; a production build records its rewrites, so rebuild before production restart. `.env.web` takes precedence over root `.env` for web configuration. It is ignored by Git. The existing managed controller still needs its full root `.env`.

The page shows the warning after an ordering request fails. Check connection or automatic polling reloads catalog/cart after recovery and clears it once that initialization succeeds. A shopper opened while ordering is unavailable can resume adding products without refreshing the page. Last-observed records can remain visible during an outage; they do not prove current backend availability. Validation/conflict responses keep their useful business explanation. If a checkout response is lost, recover its retained original body/key before attempting a fresh purchase.

## Backend machine: backend processes

Use the same source revision and pinned Node version in a separate checkout. Prepare its private root `.env` from `.env.example`. Configure database/broker/cache addresses reachable from this machine. For APIs and dependencies managed on this backend machine, use `TOPOLOGY=single`; this describes the operator's managed resources, not the physical location of the independent web browser. Set the API URLs to this machine’s listening ports. Owner servers bind all interfaces, allowing the M3 proxy to reach them over your LAN.

Use a Docker engine dedicated to the lab or select the intended Docker context explicitly. With local dependencies, run these from the backend checkout:

```sh
docker compose --env-file .env up -d --wait postgres rabbitmq redis toxiproxy
pnpm exec tsx tools/migrate.ts
pnpm exec tsx tools/seed.ts
```

For the existing dedicated Lima guest, set `TOPOLOGY=single` and `REMOTE_VM=ecommerce-lab` on the backend host. The operator then runs its scoped Compose controls through local `limactl shell`; it does not use the host's default Docker context or SSH to another machine. Start the guest with `limactl start ecommerce-lab`. Run Compose inside its mounted checkout using the existing `.lab/remote.env` projection, and configure the host's Node APIs to use the guest's forwarded ports. Follow [the guest runbook](remote-lab-vm.md) for forwarding and projection setup; do not assume guest-only Docker names resolve on macOS. Stop the containerized fulfillment profile before starting foreground fulfillment on the host. Host APIs need host-reachable addresses; the guest projection keeps container DNS names. Preserve the existing Compose project and volumes when changing process placement.

Open a separate VSCode terminal for each foreground process:

```sh
pnpm dev:ordering
pnpm dev:fulfillment
pnpm dev:operator
```

These are three separate commands/terminals, not one script. You can stop one with Ctrl+C and observe the other processes. The existing `./lab start` orchestrates its original managed topology and also starts web; it is not the web-only or manually split startup command. Keep manual and managed operation exclusive for each named process.

The API processes are independent of web, but still need their own data/broker dependencies. The web warning describes ordering request availability, not a complete diagnosis of fulfillment: ordering can accept an order while asynchronous fulfillment is waiting for recovery. The dashboard shows each owner separately.

### Move managed owners into foreground terminals

The deployment can start each owner as a recorded background process while preserving its stdout in `.lab/`. For interactive development, stop those instances from the backend checkout before launching foreground replacements. Run lifecycle commands on the machine that owns the processes; the client checkout runs web only. The legacy whole-lab `start` command still includes web on the controller host, so use named backend controls or the individual development commands for this split.

If the backend host uses the isolated lab toolchain rather than nvm, set its path in each new terminal:

```sh
export PATH="$HOME/.local/share/ecommerce-lab/node-v24.21.0-darwin-x64/bin:$HOME/.local/share/ecommerce-lab/bin:/usr/local/bin:$PATH"
node --version # expected: v24.21.0
pnpm --version # expected: 10.21.0
```

From the backend repository root, stop the managed API instances while operator is still available, then stop operator itself:

```sh
./lab stop ordering
./lab stop fulfillment
node --import tsx --input-type=module -e "import {stopService} from './tools/operations.ts'; await stopService('operator');"
```

Now run `pnpm dev:ordering`, `pnpm dev:fulfillment` and `pnpm dev:operator` in three separate backend terminals. Use a fourth for `pnpm logs all`. Start/restart one foreground owner by stopping it with Ctrl+C and rerunning its command. On the client machine, the equivalent web transition is to stop its recorded web process with the same `stopService('web')` helper, then run `pnpm dev:web`. Do not launch both managed and foreground processes on the same port.

Open the shopper on the client at port 4310 and the independent diagram at the backend's reachable operator origin plus `/architecture`, on port 4313. Private `.env.web` contains that operator origin. Reloading backend logic does not require restarting web when its HTTP contract and origin remain compatible. Changing a proxy origin requires restarting development web or rebuilding production web.

## Follow requests and responses in terminals

On the machine running the owner, open another terminal:

```sh
pnpm logs ordering
pnpm logs fulfillment
pnpm logs operator
pnpm logs all
pnpm logs all <correlation-UUID-or-checkout-key-reference>
```

Each command is an alternative viewer. It prints structured input/process/output records every half second from bounded local owner windows, including HTTP input/output, transaction observations, received/published envelopes and processing outcomes. It prints the initial retained window once, then newly observed IDs. It does not collect remote files automatically or guarantee an exhaustive high-volume audit trail. For a guest process, run the viewer in that guest checkout or follow its mounted `.lab/logs` there. Use the dashboard Timeline for browser-side request observations; the web terminal shows Next.js startup/proxy diagnostics.

Ctrl+C stops the viewer without stopping its APIs. A quiet window is not proof of health. Use owner `/health` and the dashboard sampled states alongside it. Raw idempotency keys remain excluded from activity; follow their shopper-scoped submission references.

On the backend host, use `btop` for physical-host counters and `limactl shell ecommerce-lab btop` for guest counters. For native dependency stdout, enter the dedicated guest with `limactl shell ecommerce-lab`, change to the mounted backend checkout, and run:

```sh
docker compose --env-file .lab/remote.env logs --follow --tail 100 postgres rabbitmq redis toxiproxy
```

These viewers observe different layers: owner logs explain business decisions, container stdout explains dependency behavior, and btop measures resource use in its selected host or guest. Stopping a viewer leaves those systems running.

## Memory, shutdown and generated files

JavaScript garbage collection reclaims unreachable objects. The lab bounds activity history and viewer identity sets; polling is sequential and cancelled when Shop is disposed. Application SIGINT/SIGTERM stops and drains owner loops, closes HTTP/broker/cache/database resources, and saves a receipt. Failure or timeout is recorded while the remaining independent closers are still attempted. SIGKILL/crashes cannot execute these graceful handlers; persisted attempts/outbox records remain recoverable.

Routine cleanup retains order/history data, unresolved submissions, volumes and reports. Managed full and individual stops save measured cleanup evidence. For manually started APIs use Ctrl+C in each owner terminal. Stop the local web/API processes before explicitly removing their generated build/test artifacts:

```sh
pnpm clean:generated
```

This refuses deletion while default or configured local web/ordering/fulfillment ports are listening. Configure custom listener ports consistently in root `.env`, and ensure no builds/tests start concurrently with cleanup. The operator may remain running. Only `apps/web/.next`, `coverage`, `test-results`, `playwright-report` and `.lab/browser.env` are removed. Intermediate symlinks are rejected. Dependencies, source, configuration, durable/recovery state, volumes and activity logs are retained. No remote machine, VM, Docker image or unrelated project is pruned by this command. Explicit lab reset remains the separate destructive action.

Private receipts live under `.lab/reports/` and are retained until explicitly removed. Each lists scope, observed result, retained resources, lessons and recovery guidance. A managed stop also leaves its latest report at `.lab/cleanup.json` and `/api/v1/resources`. Diagnostic suggestions identify what to inspect; they do not claim an unobserved root cause or return to baseline. Disk byte totals do not establish reclaimed host RAM. Report persistence failure is a failed cleanup diagnostic, not evidence of successful cleanup.

## Reusable API client, later publication

`packages/client` already contains a transport wrapper that accepts a base origin, validates shared response contracts, retries reads once, and never automatically replays checkout. Another client can use this interface without embedding owner rules. HTTP/event contracts are the compatibility seam; PostgreSQL and RabbitMQ remain server implementation details. A frontend can use a same-origin proxy, while a direct browser-origin client will need an explicit CORS/authentication policy before public access.

The package is currently private and exports TypeScript source. It has not been published or certified as an external SDK. Before a public release, choose a package name/version, build JavaScript and declarations, include its contract dependency, test an actual package tarball in a separate client project, and document authentication, compatibility and recovery behavior. A package registry hosts the package; npm, pnpm, Yarn and Bun are client installation tools. Publishing a client library does not deploy a backend server.

Stripe integration would be a separate server-owned payment adapter and state transition design. The current simulated fulfillment does not implement payment charging, webhook authentication or payment compensation. Keep those out of this learning slice until the existing flow and its guarantees are understood.
