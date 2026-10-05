# Operating the local lab

## First run

Install the Node version recorded in .nvmrc, pnpm 10.21.0, Docker with Compose, and lsof. Linux also requires `ss` (provided by `iproute2`; install with `sudo apt install iproute2`). Native lifecycle checks inspect listening sockets and verify that the owning process belongs to this checkout. Linux uses `ss` and `/proc` because older lsof versions can miss Next.js process names; macOS uses lsof. Copy .env.example to .env, review ports, then run scripts/bootstrap from the repository root. It installs locked dependencies, bootstraps the operator, migrates/seeds the owner databases and starts the lab. It builds the production frontend on each web start so source/config changes are reflected.

The ignored root .env is the editable configuration source. Missing or invalid required settings are logged without values and stop startup. See [configuration](configuration.md) for the required keys and error format. SSH key files remain separate and should be referenced through your SSH configuration. Do not edit .lab/remote.env; it is a generated projection. Change database initialization settings only before a fresh lab reset/recreation.

| Command                                                 | Behavior                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ./lab                                                   | Terminal menu; operator remains usable while web is down                                |
| ./lab operator                                          | Bootstrap/check the operator                                                            |
| ./lab start / stop                                      | Start or immediately stop the named lab systems                                         |
| ./lab start ordering / stop ordering / restart ordering | Operate one named service; replace ordering with web, fulfillment, postgres or rabbitmq |
| ./lab status                                            | Read observed service readiness                                                         |
| ./lab seed                                              | Populate a fresh catalog; preserve existing catalog records                             |
| ./lab reset                                             | Stop work, erase lab volumes/queues/activity/state, migrate and reseed                  |
| ./lab pause / resume                                    | Drain the active fulfillment attempt, then pause new attempts; or resume                |
| ./lab preset fulfillment slow                           | Set the preset for newly recorded jobs; existing jobs retain theirs                     |
| ./lab monitor                                           | Open btop on the current machine                                                        |
| pnpm openapi                                            | Export running owner contracts and the event schema into docs/contracts/                |

CLI and dashboard submit the same named actions to the operator. It serializes them and persists bounded action history. Failed signals/commands are reported as failures. Actions interrupted by operator restart are recorded as unknown completion failures and are not automatically replayed. The operator itself is bootstrapped from the terminal rather than stopping itself through its HTTP interface. scripts/cleanup-startup is an exceptional startup-cleanup helper: it checks listeners' working directories before clearing these checkout's processes.

For a complete shutdown on both machines, resource cleanup, verification and restart, use the [shutdown and cleanup runbook](shutdown-and-cleanup.md). It distinguishes preserved volumes from explicit data deletion.

## Two-machine topology

The current independent split runs web on the client host and all three APIs on the backend host. Run lifecycle controls from the backend checkout, using `TOPOLOGY=single` and `REMOTE_VM=ecommerce-lab` for its local dedicated guest. Dependencies run in that guest; host APIs use forwarded ports. Client `.env.web` contains HTTP origins only. The original `TOPOLOGY=two` controller arrangement remains an alternative: ordering/operator/web on the controller and dependencies/containerized fulfillment on its configured remote host. Follow [independent development](independent-development.md) for the current split; whole-lab `start` still includes web on the controller.

See the [remote guest runbook](remote-lab-vm.md) for pinned setup, port forwarding and btop scopes. The operator generates `.lab/remote.env` and explicitly selects the configured guest rather than the host's default Docker context. Missing remote settings name the variables in terminal diagnostics.

Stop the old lab before changing topology. Moving hosts recreates and reseeds lab data; there is no data-migration routine. The [verification record](verification.md) distinguishes tested local behavior from remote deployment and capacity measurements.

## Observations and troubleshooting

The dashboard has Overview, Architecture, Cache, Shoppers, Failure Lab, Records, Timeline, Metrics and Controls. It polls every two seconds with pause/manual refresh. Failed producer queries retain their last recorded data with stale/unavailable labels. Process counters reset on restart; outbox sampling timestamps reveal when durable gauges become stale. IDs belong in record/activity drill-down, not metric labels.

Run btop on each physical host and inside the Linux guest to distinguish host pressure from guest limits. Use docker stats for lab containers. Record workload, topology, sample time and scope. Process RSS includes only that process; host memory includes other applications; a container snapshot does not establish the full system's peak resource use. Unsupported sensor/process measurements are unavailable, never zero by assumption.

Structured owner activity is retained locally for seven days and capped at 100 MiB across the host's .lab/logs files. The activity endpoint returns a bounded recent window; archived days remain local files until pruning. Startup stdout/stderr files are diagnostic process output, separate from the bounded structured activity stream. Reset clears owned lab data and logs while retaining machine setup and canonical configuration.

If a checkout is ambiguous, use Recover submission rather than creating another key. For conflicts, preview again. During a dependency outage inspect readiness and pending outbox work; do not count connectivity retries as processing attempts. Following an unexpected crash, explicitly request restart. Inspect action failure details before repeating reset/restart operations.

## Verification commands

Run pnpm quality and pnpm build for static/unit/build gates. With the lab running, run pnpm test:integration, then pnpm test:recovery, then pnpm test:learning, then pnpm test:e2e sequentially: these tests change global simulation settings and intentionally interrupt lab dependencies. Install the selected Chromium with pnpm exec playwright install chromium (Linux may need --with-deps). Recovery tests intentionally restart fulfillment and stop/start PostgreSQL/RabbitMQ; run only against this disposable lab. The GitHub ecosystem job uses an isolated runner and this same sequence.

For Docker-based browser verification, run `./lab test-browser` while the lab is running. It builds the pinned Node 24/Playwright Linux image, generates a testing-only configuration projection from the canonical root .env, and runs the suite with a one-GB container limit. The first browser image download is roughly one GB; it is optional verification tooling and is not part of the running lab. Failure screenshots/traces appear in test-results/. Its host.docker.internal mapping targets the local web process on Docker Desktop; Linux hosts must make that web listener reachable from their Docker bridge or run the native Playwright checks instead.

## Complete-lab controls and measured cleanup

Use `./lab restart` for the entire lab, `./lab poweroff` to stop its configured dedicated guest as well, and `./lab resources` to inspect the saved stop-phase evidence. The operator's HTTP origin serves a recovery control page even when web is down. Complete stop removes lab containers/networks but preserves volumes and reports remaining allocations; it never certifies an unobserved baseline. [Control, logging and test evidence guide](runtime-observation.md).
