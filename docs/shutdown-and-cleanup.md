# Shutdown, cleanup and restart

Routine cleanup retains orders, history, unresolved submissions and diagnostic reports. The current split runs shopper web on the client host, three APIs on the backend host, and dependencies in its dedicated `ecommerce-lab` Lima guest. Run backend lifecycle controls from the backend checkout. See [independent development](independent-development.md) for foreground versus managed ownership.

## Finish active work

Stop new simulated shoppers with `./lab feeder stop`, then inspect `./lab feeder status` until active work reaches zero and the run has a terminal outcome. Let any failure exercise finish and verify restoration. Lifecycle controls reject conflicting work. Preserve unknown checkout submissions for explicit recovery.

## Stop managed backend resources

From the backend checkout:

```sh
./lab stop
./lab resources
```

Inspect the action outcome and report. Stop attempts every independent owned cleanup, removes the lab Compose containers/networks and verifies listener/container state. Volumes, images, source, configuration, logs and reports remain. The operator stays running for recovery. A failed or unavailable probe is not verified cleanup.

Use `./lab poweroff` instead when the dedicated guest should also release its running allocation. With `TOPOLOGY=single` and `REMOTE_VM=ecommerce-lab`, it controls the local guest; the original `two` arrangement controls its configured remote guest. The guest disk remains. Other guests are outside this operation.

Stop the remaining managed operator only after reading its receipt:

```sh
node --import tsx --input-type=module -e "import {stopService} from './tools/operations.ts'; await stopService('operator');"
```

For foreground owners, use Ctrl+C in each API terminal instead. SIGINT/SIGTERM drains registered resources and saves a private shutdown receipt. A crash or SIGKILL cannot run graceful cleanup; persisted attempts and outboxes remain recoverable.

## Stop independent shopper web

On the client host, press Ctrl+C in its development terminal. For managed web:

```sh
node --import tsx --input-type=module -e "import {stopService} from './tools/operations.ts'; await stopService('web');"
```

Do not run backend lifecycle actions from the web-only checkout. Read-only `./lab status` can inspect configured origins without starting a local operator.

## Verify and inspect a failed teardown

Check each owner host for configured listeners. For default macOS ports:

```sh
lsof -nP -iTCP:4310-4313 -sTCP:LISTEN
limactl list
```

An operator retained intentionally still listens on 4313. Inspect ownership before terminating a remaining listener. To inspect containers in a running dedicated guest, enter it, change to the mounted backend checkout and run:

```sh
docker compose --env-file .lab/remote.env ps -a
docker compose --env-file .lab/remote.env logs --tail 100 postgres rabbitmq redis toxiproxy
```

If teardown failed, inspect its action/report error, guest connectivity, the selected Compose project and native dependency logs. Retry the named cleanup after correcting that cause; do not switch Docker engines or globally prune the host. For local Docker without a guest, use root `.env` on that explicitly selected engine instead.

## Explicit generated-cache removal

After local web, ordering and fulfillment listeners stop:

```sh
pnpm clean:generated
```

This removes only `apps/web/.next`, `coverage`, `test-results`, `playwright-report` and `.lab/browser.env`. It refuses active default/configured application listeners and unsafe intermediate symlinks. It retains dependencies, reports, activity, configuration, volumes, source and recovery records. Run it separately on each checkout; it does not delete remote files. Avoid simultaneous builds/tests during cleanup.

The retained `.lab/reports/` receipt lists attempted removals, errors, retained resources, lessons and recovery guidance. Managed stop evidence is also at `.lab/cleanup.json` and `/api/v1/resources`. Before/after counters are observations, not a certified return to an idle baseline. Report persistence failure is a failed diagnostic.

## Deliberate data erasure

`./lab reset` is the separate destructive reset/reseed action. It is not routine cleanup. Deleting the stopped dedicated guest with `limactl delete ecommerce-lab` erases its databases, queues, images and installed tools; the host checkout remains. Do so only when deliberately recreating that lab. The 40 GiB sparse-disk limit is not a measured amount of reclaimed space. Never target other guests or use global Docker pruning.

## Restart the current split

Start the retained guest on the backend host with `limactl start ecommerce-lab`. Start only PostgreSQL, RabbitMQ, Redis and Toxiproxy through its existing `.lab/remote.env` Compose projection. Keep the old fulfillment container stopped when using the native host API. Existing volumes do not need reseeding.

Run `pnpm dev:ordering`, `pnpm dev:fulfillment` and `pnpm dev:operator` in separate backend terminals; run `pnpm dev:web` on the client. Inspect owner readiness, the independent console and retained pending work before a new purchase. Do not automatically resubmit a checkout. Named managed starts are alternatives to those foreground owners; never start both on the same port. Whole-lab `./lab start` also starts web on its controller host.

See [guest setup](remote-lab-vm.md), [configuration](configuration.md) and [independent startup/log commands](independent-development.md). References: [Compose down](https://docs.docker.com/reference/cli/docker/compose/down/), [Lima stop](https://lima-vm.io/docs/reference/limactl_stop/), [Lima delete](https://lima-vm.io/docs/reference/limactl_delete/).

## Shutdown during a failure exercise

For a foreground operator, Ctrl+C or SIGTERM stops accepting new exercises, ends the active fault window and waits for the registered restoration before exiting. Changed services are restarted, the scoped network fault is removed, or the previous processing preset is restored. The experiment record retains `interrupted` with its restoration outcome and an after-snapshot. Restoration failures remain `failed` and make the shutdown report unverified; inspect the failed target and use the explicit experiment restoration control before another exercise.

Exercise restoration has a bounded three-minute shutdown allowance because a named dependency command can take up to two minutes. Other connection closers retain their five-second limit. Forced termination, including a managed command that uses SIGKILL, cannot execute this handler; restart the operator, inspect the retained experiment and explicitly restore it if restoration is unknown. A timeout reports unverified cleanup rather than certifying recovery.
