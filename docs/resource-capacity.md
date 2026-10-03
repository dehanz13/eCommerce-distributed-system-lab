# Resource capacity: configure, measure, compare

Capacity is a constraint, not a measurement. The dedicated guest template assigns **4 CPUs, 4 GiB RAM and a 40 GiB sparse disk limit**. Compose currently caps PostgreSQL at 1 GiB, RabbitMQ at 768 MiB, Redis at 128 MiB, Toxiproxy at 64 MiB and remote fulfillment at 512 MiB. Native processes, Docker/guest overhead, builds and browser tooling add usage. These limits do not establish a peak footprint or guarantee the eight-GB target.

## 1. Capture a baseline before changing anything

On the application host, from the checkout:

```sh
./lab status
./lab monitor
docker compose --env-file .env ps
docker compose --env-file .env stats --no-stream
# Files and Docker engine inventory; engine totals include other projects.
du -sh node_modules apps/web/.next .lab coverage 2>/dev/null
docker system df
```

On the remote physical host:

```sh
limactl list
btop
limactl shell ecommerce-lab free -h
limactl shell ecommerce-lab df -h /
limactl shell ecommerce-lab nproc
limactl shell ecommerce-lab btop
```

From the application host, `./lab monitor remote-host` and `./lab monitor lab-vm` open the same two observation scopes over SSH. btop is an interactive observer; record its timestamp and CPU/memory/network/process readings in a private report or screenshot. It does not supply a machine-readable historical report to this repository.

For container reports, run the following **inside the lab Linux guest**, from its mounted checkout (or locally for single topology):

```sh
# Guest uses the generated .lab/remote.env; single topology uses .env instead.
docker compose --env-file .lab/remote.env --profile remote stats --no-stream --format json
docker compose --env-file .lab/remote.env --profile remote ps -a
```

Compare the same workload and interval. Record topology, runtime/image revisions, CPUs/guest RAM, shopper count/concurrency/think time, start/end times and measurement scope. Host free memory includes other applications; container limits differ from current RSS; guest free space differs from allocated host disk blocks. Unsupported readings are unavailable.

## 2. Change the dedicated guest CPU and RAM

Finish shoppers/exercises and `./lab stop` on the application host. On the **remote macOS host**, target only the dedicated guest:

```sh
limactl stop ecommerce-lab
limactl edit --cpus=4 --memory=4 ecommerce-lab
limactl start ecommerce-lab
limactl shell ecommerce-lab nproc
limactl shell ecommerce-lab free -h
```

`--cpus` takes an integer CPU count; `--memory` takes GiB. For example, `--cpus=2 --memory=3` assigns two CPUs and three GiB. Choose allocations after checking physical-host pressure. Do not assume all physical RAM is available. Restart the lab from the application host after the guest starts, then recheck readiness and repeat the same traffic sample.

The edit changes that guest's persistent configuration. For a **new** guest, edit `cpus`, `memory` and `disk` in the tracked template through a reviewed change before regenerating it with `pnpm exec tsx tools/vm-template.ts`. Root `.env` remains the deployment-address/configuration source. Capacity fields currently live in the explicit infrastructure definitions; no `VM_RAM` or equivalent environment setting is implemented. Regenerating the YAML does not resize an existing guest.

## 3. Grow the guest disk

On the remote physical host, with the lab stopped:

```sh
limactl stop ecommerce-lab
limactl edit --disk=60 ecommerce-lab
limactl start ecommerce-lab
limactl shell ecommerce-lab lsblk
limactl shell ecommerce-lab df -h /
```

`--disk` takes GiB. Confirm the virtual device and filesystem capacity after boot. If the virtual device grew but the partition/filesystem did not, inspect the image's supported grow procedure rather than assuming the space is usable. This guide does not prescribe a filesystem-specific command without knowing the actual layout. Do not shrink a disk containing lab records.

Lima also exposes `limactl disk list` and `limactl disk resize DISK_NAME --size 60GiB` for **additional managed disks**. That disk name is not the guest name; the shipped template does not attach one. Do not run the additional-disk command against a guessed target. A sparse disk's capacity is different from physical space consumed. Guest deletion deliberately erases data; see the shutdown runbook.

## 4. Change a container limit persistently

For reproducibility, edit the service's `mem_limit` and `cpus` in `compose.yaml` through a reviewed change. CPU values are quotas (`0.5` is half a CPU); memory examples are `768m` and `1g`. Both topologies use the same definitions. These are Compose fields, not implemented root environment variables.

Stop shoppers/exercises, then on the application host:

```sh
./lab stop postgres
# Edit only postgres.mem_limit/cpus in compose.yaml; keep image and volumes.
./lab start postgres
./lab status
```

The service-specific sequence above applies to single topology, where Compose reads the edited local checkout. In **two-machine mode**, a named service start does not transfer a newly edited Compose file. Finish active work, use the full lifecycle sequence below from the application host, and retain the same root configuration:

```sh
./lab stop
# Edit the chosen service's cpus/mem_limit in canonical compose.yaml.
./lab start
./lab status
```

Full startup transfers the checkout and generates the private remote configuration before running Compose in the guest. Do not independently edit the generated `.lab/remote.env`. Verify effective limits inside the guest afterward.

Substitute `rabbitmq`, `redis` or `toxiproxy` for the named single-host service. Service recreation preserves named database/broker volumes unless you explicitly request deletion. Expect dependency disruption while changing a running service. The native fulfillment process in single topology does not acquire Docker limits; the `fulfillment` Compose limits apply to its remote container.

Inside the guest, inspect the effective container limits using the generated configuration:

```sh
CONTAINER=$(docker compose --env-file .lab/remote.env --profile remote ps -q postgres)
docker inspect "$CONTAINER" --format 'memoryBytes={{.HostConfig.Memory}} nanoCPUs={{.HostConfig.NanoCpus}}'
```

For single topology, replace `.lab/remote.env` with `.env`. Do not print full Compose configuration into public logs; it includes projected credentials.

## 5. Temporary container experiments

Inside the relevant Docker engine/guest, target a container obtained from **this Compose project**:

```sh
CONTAINER=$(docker compose --env-file .lab/remote.env --profile remote ps -q postgres)
test -n "$CONTAINER"
docker update --cpus=0.75 --memory=768m --memory-swap=768m "$CONTAINER"
docker inspect "$CONTAINER" --format 'memoryBytes={{.HostConfig.Memory}} nanoCPUs={{.HostConfig.NanoCpus}}'
# Restore the shipped PostgreSQL caps for the same live container:
docker update --cpus=1 --memory=1g --memory-swap=1g "$CONTAINER"
```

These edits affect that existing container, not `compose.yaml`. Equal memory and memory-swap disallow container swap where supported. Lowering limits beneath active usage can terminate a process; inspect pending work and readiness afterward. A container recreated from Compose uses the tracked settings. Save experiment parameters in your private report; do not confuse this with a persistent deployment change.

## 6. Redis data capacity versus process capacity

Redis's `--maxmemory 96mb` is a dataset eviction threshold. Its 128 MiB container cap includes process overhead. Keep headroom between them. Current policy is `allkeys-lru`; persistence is disabled.

Inside the engine hosting the lab:

```sh
# Use .env in single topology; .lab/remote.env inside the guest.
docker compose --env-file .lab/remote.env exec -T redis redis-cli INFO memory
docker compose --env-file .lab/remote.env exec -T redis redis-cli CONFIG GET maxmemory
docker compose --env-file .lab/remote.env exec -T redis redis-cli CONFIG GET maxmemory-policy
# Temporary dataset-limit experiment (bytes):
docker compose --env-file .lab/remote.env exec -T redis redis-cli CONFIG SET maxmemory 50331648
# Restore 96 MiB:
docker compose --env-file .lab/remote.env exec -T redis redis-cli CONFIG SET maxmemory 100663296
```

The temporary 48 MiB threshold can cause eviction when the dataset exceeds it; changing a threshold alone does not guarantee eviction. Process metrics and key eviction counts are different observations. Persist a new dataset limit by reviewing the `redis.command` in Compose. Restart/recreation restores its declared setting. Checkout remains SQL-authoritative in every cache scenario.

## 7. Control workload and inspect saturation

Use `POST /api/v1/feeder` with all four fields:

```sh
curl --fail-with-body -sS http://127.0.0.1:4313/api/v1/feeder \
  -H 'Content-Type: application/json' \
  -d '{"shoppers":60,"concurrency":6,"seed":42,"thinkMs":300}'
./lab feeder status
./lab feeder stop
```

Change one parameter, wait for the run to finish, then compare. Limits: 1–500 shoppers, 1–20 concurrent journeys, seed 1–2147483647, think time 0–2000 ms. Watch accepted/rejected/unknown separately, request timing, job queue and pending outbox age. The ordering and fulfillment connection pools each currently use five connections, a two-second connect timeout and five-second statement timeout in `packages/runtime/src/index.ts`; these are code parameters, not tunable environment keys. No capacity knob is advertised unless implemented.

References: [Lima edit flags](https://lima-vm.io/docs/reference/limactl_edit/), [Lima managed disk resize](https://lima-vm.io/docs/reference/limactl_disk_resize/), [Docker update options](https://docs.docker.com/reference/cli/docker/container/update/), [Redis maxmemory and eviction](https://redis.io/docs/latest/develop/reference/eviction/), [btop capabilities](https://github.com/aristocratos/btop).
