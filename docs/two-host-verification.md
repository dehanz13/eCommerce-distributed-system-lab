# Two-host verification

Physical two-host verification completed on October 3, 2026 UTC. The application ran with web, ordering and operator on the application host, and PostgreSQL, RabbitMQ, Redis, Toxiproxy and fulfillment in the dedicated Linux guest. The [snapshot](two-host-snapshot.json) contains UTC action times, workload results, separate measurement sources and cleanup evidence. Application source was `d866e4b`; this release also corrects a browser-test ordering assumption. Other workloads remained running.

## Observed baseline

The pinned Ubuntu 24.04 x86_64 image provisioned successfully. The dedicated guest has configured allocations of four CPUs, 4 GiB RAM and a 40 GiB disk limit. Docker 29.8.2, Compose 5.5.1 and guest btop 1.3.0 were observed installed. SSH reached the remote host, and Docker access worked through the guest without elevation.

| Observation           | Remote physical host | Dedicated guest |
| --------------------- | -------------------- | --------------- |
| btop version          | 1.4.7                | 1.3.0           |
| btop total memory     | 32.0 GiB             | 3.82 GiB        |
| btop used memory      | 16.2 GiB             | 476 MiB         |
| btop available memory | 15.7 GiB             | 3.35 GiB        |
| btop free memory      | 42.0 MiB             | 2.44 GiB        |

These are rounded values from separate SSH terminal captures, not simultaneous readings or measured peaks. The snapshot retains each capture timestamp. Host memory includes the dedicated guest and unrelated workloads; do not add the host and guest values. Free, available and cached memory have different meanings. The guest operating system's reported total differs from its configured allocation. No eight-GB footprint or complete return to baseline has been established.

## 1. Check the configured target

From the application-host checkout, preserve the root configuration before editing it. Follow [the dedicated guest guide](remote-lab-vm.md) for the required settings and [configuration](configuration.md) for diagnostics. Keep private addresses, SSH material and configuration out of reports.

```sh
nvm use
pnpm install --frozen-lockfile
pnpm exec tsx tools/vm-template.ts
```

On the remote physical host, privately transfer the generated template, inspect existing guests, and create only the missing dedicated guest:

```sh
limactl list
limactl start --name=ecommerce-lab --tty=false <generated-template-path>
limactl shell ecommerce-lab nproc
limactl shell ecommerce-lab free -b
limactl shell ecommerce-lab df -B1 /
limactl shell ecommerce-lab docker version
limactl shell ecommerce-lab docker compose version
```

Set `TOPOLOGY=two` in root `.env` and configure reachable database, broker, cache, proxy and fulfillment addresses as described in the guest guide. Reload the operator from the application-host checkout:

```sh
./lab reload-operator
./lab start
./lab status
```

Require a completed startup action and ready owner services. Guest creation alone does not prove application readiness. Do not repeat startup while an earlier action is pending; inspect its original action ID.

## 2. Capture comparable observations

Before starting application services, during a fixed workload, after managed services stop, and after the dedicated guest stops, record UTC times and source scopes separately.

```sh
# Application host, checkout root
./lab monitor
./lab monitor remote-host
./lab monitor lab-vm
```

On the remote physical host:

```sh
date -u +%FT%TZ
memory_pressure -Q
sysctl vm.swapusage
limactl list
limactl shell ecommerce-lab free -b
limactl shell ecommerce-lab df -B1 /
```

Inside the dedicated guest's mounted checkout:

```sh
docker compose --env-file .lab/remote.env --profile remote stats --no-stream --format json
docker compose --env-file .lab/remote.env --profile remote ps -a
```

btop is an interactive observation, not a historical metric store. Retain private terminal captures or screenshots and publish only safe measurements. Do not print full projected configuration or unrestricted process command lines into public reports. The [capacity guide](resource-capacity.md) lists CPU, RAM, disk and container-limit parameters.

## 3. Run one fixed shopper workload

From the application host, with the lab ready and no other action or exercise active, choose the success preset and run the same parameters for each comparison. The following uses the default operator origin; substitute the configured origin.

```sh
./lab preset fulfillment success
curl --fail-with-body -sS http://127.0.0.1:4313/api/v1/feeder \
  -H 'Content-Type: application/json' \
  -d '{"shoppers":60,"concurrency":4,"seed":42,"thinkMs":300}'
./lab feeder status
```

Poll status until the run finishes. Record accepted, abandoned, rejected and unknown outcomes separately. Wait for accepted orders to reach a terminal state; completion of the shopper run does not imply fulfillment completion. Record queue/outbox observations, cache counters and resource readings for the same interval. The feeder reports total request time and request count; their ratio is a mean, not a percentile. A seeded plan makes shopper choices repeatable, but IDs, scheduling and measured times still vary.

If any submission has an unknown outcome, inspect and recover its original submission explicitly before another run. Do not replace its idempotency key or automatically resubmit checkout. The [command reference](command-reference.md) documents the recovery endpoint.

## 4. Verify transactions and interruption recovery

Run these suites sequentially against this disposable lab. They create fictional records and interrupt lab dependencies; they do not belong on unrelated services.

```sh
pnpm test:integration
pnpm test:recovery
pnpm test:learning
```

Record the exit status and actual assertion results, including failures. Verify correlated activity from ordering, fulfillment and operator through the dashboard. A passing mock or CI run on one host does not establish this physical two-host deployment.

## 5. Stop, restart and release the guest

Finish traffic and exercises first. From the application host:

```sh
./lab feeder stop
./lab experiment status
./lab stop
./lab resources
./lab start
./lab status
./lab poweroff
./lab resources
```

If an experiment is active, allow it to finish or use its documented restore endpoint before stopping. `stop` removes managed containers/networks and owned application listeners while retaining volumes and the operator. `start` must reproduce readiness with retained durable records. `poweroff` also stops the configured dedicated guest. Check that other guests remain in their original state.

Compare post-stop observations with the same scope's baseline. Host free-memory changes include operating-system caches and unrelated workloads; a positive delta is not exclusive reclaimed capacity. The operator, VM disk, volumes, images and build caches remain allocated. Follow [shutdown and cleanup](shutdown-and-cleanup.md) for separately scoped cleanup; do not globally prune the host.

## Observed application and failure results

Initial startup completed from 03:36:01.710 to 03:38:10.200 UTC. Both owner services reported database and broker readiness, and web responded. Remote fulfillment has no local PID file, so its existing requested-state field remained `unknown`; readiness and container inspection established its observed running state separately.

The fixed workload started at 03:39:14.099 and finished shoppers at 03:39:26.341 UTC. Its 51 accepted orders were all fulfilled by 03:39:30.680 UTC. It recorded nine abandoned carts, zero rejections, zero unknown submissions and zero errors across 285 requests. Total recorded request time was 37,673.101 ms, giving a 132.186 ms mean. That sum spans concurrent requests; it is not elapsed wall time or a percentile. Five observer samples were collected during the shopper run.

| Remote container | Memory sample at 03:39:19 UTC | CPU sample |
| ---------------- | ----------------------------- | ---------- |
| Fulfillment      | 133.7 MiB / 512 MiB limit     | 8.18%      |
| RabbitMQ         | 126.5 MiB / 768 MiB limit     | 7.14%      |
| PostgreSQL       | 63.84 MiB / 1 GiB limit       | 8.56%      |
| Redis            | 6.461 MiB / 128 MiB limit     | 0.27%      |
| Toxiproxy        | 2.801 MiB / 64 MiB limit      | 0.73%      |

The five rounded memory values total approximately 333.30 MiB at that sample. This excludes guest overhead, native applications, the operator, local Docker and browser/build tooling. CPU percentages describe that sampling interval, not service limits or saturation. No full-system peak or eight-GB budget guarantee follows from this sample.

Later btop frames were collected after shopper traffic and fulfillment drained, not during that traffic:

| Phase and scope                   | Used memory | Available memory | Free memory |
| --------------------------------- | ----------- | ---------------- | ----------- |
| After fixed workload: remote host | 15.7 GiB    | 16.2 GiB         | 362 MiB     |
| After fixed workload: guest       | 926 MiB     | 2.91 GiB         | 202 MiB     |
| After guest poweroff: remote host | 12.6 GiB    | 19.3 GiB         | 4.67 GiB    |

Capture completion times and versions are in the snapshot. These frames are rounded and sequential; they must not be treated as simultaneous samples or exclusive reclaimed capacity.

The observer initially asserted that an early shopper would remain in the bounded recent log window. That assertion failed after all business work had completed. Follow-up inspection of the saved run found the early Ordering trace outside the 512 KiB daily-file window; its retained raw log contained matching records. The latest accepted journey returned 105 Ordering and 20 Fulfillment records with the same correlation ID. All three owner sources were reachable. The operator had no matching transaction entries for that shopper; its feeder observations describe the aggregate run. The observer follow-up did not repeat the shopper traffic. Missing recent records do not establish missing durable work or a complete audit trail.

## Verification and test correction

| Check                                                            | Observed result                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Real transaction integration                                     | Passed: competing checkout, preservation, replay/conflicts, last-write-wins, compensation and recovery     |
| Recovery suite                                                   | Passed: discarded response, recorded-attempt restart, duplicate delivery, broker and database interruption |
| Learning suite                                                   | All nine named fault scenarios restored; catalog invalidation verified                                     |
| Initial browser suite                                            | 11 passed, one failed                                                                                      |
| Corrected reconfirmation test                                    | Three consecutive targeted passes                                                                          |
| Final browser suite                                              | 12 passed in 1.4 minutes                                                                                   |
| TypeScript, lint, formatting and unit coverage                   | Passed; 140 cases in 21 files                                                                              |
| Business line coverage                                           | 617/630, 97.93%; 91% gate                                                                                  |
| Overall line coverage                                            | 1070/2108, 50.75%; separate configured scope                                                               |
| Publication, package advisory and reachable-history secret scans | Passed within configured scope                                                                             |

The failed browser trace established that the price update completed while the preview request was still in progress; the preview correctly returned 600 cents. The test had intended to confirm a stale 500-cent preview. It now awaits that response, asserts 500 cents, waits for the confirmation UI, and verifies the independent price write before submitting checkout. Three targeted repeats and the full suite passed afterward. Application rules were unchanged. Failure evidence is retained privately; failed checks are not counted as passes.

Reproduce browser checks in the pinned local Docker image. Buildx state can be retained under the ignored lab directory:

```sh
BUILDX_CONFIG="$PWD/.lab/buildx" ./lab test-browser
pnpm quality
pnpm security
```

These are local physical-deployment results. Hosted checks for the release commit remain separate; earlier hosted results do not validate an uncommitted browser-test change. Container-image findings remain covered by the separate security record; a successful package/history scan does not establish vulnerability-free images.

## Full stop, restart and final cleanup

A slow fulfillment attempt began at 03:53:34.196 UTC. Complete-lab stop ran from 03:53:34.437 to 03:53:43.157 UTC and verified all seven managed services stopped. Startup with retained volumes ran from 03:54:02.084 to 03:55:23.656 UTC. The original attempt completed at 03:55:19.018 UTC, after the stopped interval, and the order became fulfilled. Its attempt ID was unchanged and its attempt count remained one. The snapshot retains the fictional IDs and lifecycle times for this recovery proof.

| Cleanup observation                                 | Full service stop  | Final poweroff               |
| --------------------------------------------------- | ------------------ | ---------------------------- |
| Seven managed services                              | Observed stopped   | Observed stopped             |
| Application-host managed web/Ordering RSS afterward | 0 bytes            | 0 bytes                      |
| Guest available-memory delta                        | +365,494,272 bytes | Unavailable after guest stop |
| Remote host free-plus-inactive delta                | +44,298,240 bytes  | +3,677,073,408 bytes         |
| Application host OS free-memory delta               | −1,343,488 bytes   | −47,382,528 bytes            |
| Dedicated guest                                     | Retained running   | Observed stopped             |
| Exact return to baseline                            | Uncertified        | Uncertified                  |

The approximately 348.56 MiB guest increase followed container teardown. The approximately 3.42 GiB remote-host increase followed final poweroff. These are within-scope OS-counter changes, not exclusive reclaimed memory. The application host's OS free memory decreased while owned application RSS reached zero, illustrating why those measures are not interchangeable.

Final OS samples after poweroff:

| Scope         | UTC sample               | Physical RAM | Memory counter                    | Free space at sampled filesystem |
| ------------- | ------------------------ | ------------ | --------------------------------- | -------------------------------- |
| operator host | 2026-10-03T03:56:00.034Z | 36.00 GiB    | 0.10 GiB (OS free memory)         | 956.66 GiB                       |
| remote host   | 2026-10-03T03:56:00.478Z | 32.00 GiB    | 14.72 GiB (Free + inactive pages) | 346.34 GiB                       |

Disk counters describe their sampled filesystem, not space reclaimed by shutdown. The snapshot names each measurement method. Guest counters are unavailable while stopped.

Final inspection found the dedicated guest `Stopped` and the other guest still `Running`. The operator remained ready on its configured origin; web and owners were unreachable as expected. No managed browser container remained after the checks. Database volumes, images, build caches, retained logs and the guest disk were kept. Monitoring captures ended and no capture-owned btop process was observed on the reachable host. Guest measurements after poweroff are unavailable rather than zero.

To restart the verified topology, run `./lab start` from the configured application-host checkout; it starts the dedicated guest and reconstructs the lab with retained records. For deliberate disk cleanup, use the scoped shutdown runbook. No shared-host prune or unrelated guest shutdown was performed.
