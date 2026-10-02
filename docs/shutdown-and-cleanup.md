# Shutdown, cleanup and restart runbook

Use this runbook to free CPU, memory or disk space on M3 and MBP19. Routine shutdown preserves source, configuration and durable lab records. The optional deletion steps explicitly identify what is erased.

The default topology runs the interactive lab on M3, with a separate `ecommerce-lab` Lima guest on MBP19. In `TOPOLOGY=two`, stop the lab from M3 while MBP19 is still reachable, then stop the guest. See [topology configuration](mbp19-lab-vm.md). Commands below use the current checkout path; adjust it if you move the repository.

## 1. Finish active learning exercises

If shoppers are running, stop new shoppers and wait until the report shows `active: 0` and a terminal run status:

```sh
cd /Users/dehanz13/development/projects/ecommerce-fullstack-ecosystem
./lab feeder stop
./lab feeder status
```

If a Failure Lab exercise is active, let it finish and confirm restoration completed. Lifecycle actions are rejected while shoppers or an exercise are active. Keep retained unknown checkout submissions for explicit recovery later.

## 2. Stop the M3 lab without erasing records

In M3 Terminal, from the checkout:

```sh
./lab stop
```

Wait for the action to report `status: completed`. If it reports a failure, inspect that error before proceeding. This stops the managed applications and dependencies; the operator remains running so its action result can be retrieved.

Then stop the remaining operator and remove any local lab containers:

```sh
./scripts/cleanup-startup
docker compose --env-file .env --profile remote down
```

The cleanup helper checks listener working directories before terminating this checkout's processes on the default ports 4310–4313. If you customized application ports, that helper does not cover those custom ports. Compose targets the `learning-core` project in the selected Docker context. Omitting `--volumes` preserves PostgreSQL and RabbitMQ volumes. Redis has no persistence, so its cached catalog disappears; PostgreSQL remains authoritative.

Verify shutdown without bootstrapping the operator again:

```sh
# macOS
lsof -nP -iTCP:4310-4313 -sTCP:LISTEN
# Linux (older lsof versions can miss Next.js)
ss -H -ltnp 'sport >= :4310 and sport <= :4313'
docker compose --env-file .env --profile remote ps -a
```

Expect no lab listeners and no remaining Compose containers. `lsof` normally exits with status 1 when it finds no matching listeners. A remaining listener can belong to another checkout; inspect its ownership rather than terminating it blindly.

Quit Docker Desktop if no other projects need it running. Close monitoring terminals, or press `q` in btop.

## 3. Stop the dedicated MBP19 guest

Run directly in MBP19 Terminal:

```sh
limactl stop ecommerce-lab
limactl list
```

Confirm `ecommerce-lab` shows `Stopped`. This releases its running CPU/memory usage while retaining its VM disk and lab data. It does not delete disk files. The existing `hearso-backend` guest is separate; target only `ecommerce-lab`.

## 4. Optional: remove rebuildable M3 files

After shutdown, remove generated dependencies, builds and test reports:

```sh
cd /Users/dehanz13/development/projects/ecommerce-fullstack-ecosystem
rm -rf node_modules apps/web/.next coverage test-results
docker image rm learning-core-browser:local
```

The folders measured approximately 1 GB on October 2, 2026; measure again with `du -sh` because their size changes. The browser image is separate verification tooling. If it is already absent, no image removal is needed; if Docker reports it is in use, finish that lab test container first.

This preserves source, `.env`, lockfiles and `.lab` recovery/activity state. Dependency installation, frontend building and browser-image building are needed again when their outputs have been removed. Avoid global Docker pruning: other projects can share the same Docker engine.

## 5. Optional: erase lab data or the guest disk

These steps erase data. Use them only when you intend to recreate and reseed the lab.

To remove the M3 lab's PostgreSQL databases and RabbitMQ volume data, from the stopped checkout:

```sh
docker compose --env-file .env --profile remote down --volumes
```

This targets local Compose volumes; it does not erase a separate MBP19 guest. Host files such as `.env` and `.lab` remain.

To remove the stopped MBP19 lab VM and its disk, run on MBP19:

```sh
limactl delete ecommerce-lab
```

This erases the guest's databases, queues, container images and installed tools. The checkout mounted from macOS remains on the host. The 40 GiB disk setting is a capacity limit, not a guarantee of 40 GiB reclaimed. Recreate a deleted VM through the [dedicated VM runbook](mbp19-lab-vm.md); the ordinary restart below assumes it still exists.

## 6. Start again

If retaining the MBP19 guest, start it there:

```sh
limactl start ecommerce-lab
```

On M3, start Docker Desktop, then:

```sh
cd /Users/dehanz13/development/projects/ecommerce-fullstack-ecosystem
nvm use
pnpm install --frozen-lockfile
./lab operator
./lab start
./lab status
```

In single-machine mode, `./lab start` starts local dependencies and rebuilds the frontend. In two-machine mode it also projects configuration and starts the remote lab services. Preserved records remain; empty lab volumes are initialized, migrated and seeded.

Starting the VM alone does not establish container readiness. To resume the separate MBP19 demonstration stack while M3 remains in single-machine mode, run on MBP19 from its mounted checkout:

```sh
cd "$HOME/development/projects/ecommerce-fullstack-ecosystem"
limactl shell ecommerce-lab sh -c 'cd "$1" && docker compose --env-file .lab/remote.env --profile remote up -d --wait' sh "$PWD"
```

This uses the existing generated remote configuration and explicitly selects the lab guest. It assumes that guest and its demonstration stack were already provisioned; adjust the checkout path to `REMOTE_DIR` if different. Inspect owner readiness after container startup.

`./lab reset` erases managed lab data and then starts/reseeds the lab. Use the shutdown steps when your goal is to free running capacity.

References: [Docker Compose down](https://docs.docker.com/reference/cli/docker/compose/down/), [Lima stop](https://lima-vm.io/docs/reference/limactl_stop/), [Lima delete](https://lima-vm.io/docs/reference/limactl_delete/).
