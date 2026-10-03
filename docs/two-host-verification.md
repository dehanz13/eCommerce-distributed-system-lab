# Two-host verification

Physical two-host verification completed on October 3, 2026 UTC. The application ran with web, ordering and operator on the application host, and PostgreSQL, RabbitMQ, Redis, Toxiproxy and fulfillment in the dedicated Linux guest. The [snapshot](two-host-snapshot.json) contains UTC action times, workload results, separate measurement sources and cleanup evidence. Application source was `d866e4b`; this release also corrects a browser-test ordering assumption. Other workloads remained running.

Runtime qualification: the application-host processes and native verification commands ran under Node **24.11.0**, although `.nvmrc` at `d866e4b` requires **24.21.0**. Fulfillment used the pinned 24.21.0 container. Keep the observed version in the snapshot: these results demonstrate the recorded deployment, but do not verify the required pinned application-host setup. No physical rerun under that pin is recorded. For a new run, install/select 24.21.0 before bootstrapping the operator and all application processes, and capture their actual runtime versions separately from container versions.

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
nvm install
nvm use
node --version
pnpm install --frozen-lockfile
pnpm exec tsx tools/vm-template.ts
```

Require `node --version` to print `v24.21.0`. This setup procedure describes the required runtime; it is not a claim that the dated physical run followed that pin. Stop existing application processes before bootstrapping from the corrected shell; changing the shell runtime does not change already-running processes.

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

## 5. Interrupt a persisted attempt and verify restart

Stop the feeder and finish or restore active experiments first; keep the lab ready for one controlled order. Do not drain this new order before stopping. The `slow` preset records a five-second deadline, so manual clicks can miss the interruption window. The following script submits the full-lab stop immediately after observing and saving the active attempt. It needs Bash, curl, jq and the selected Node runtime. Run from the application-host checkout root; the existing configuration loader supplies the three configured origins without publishing root configuration.

```sh
./lab feeder stop
./lab experiment status
mkdir -p .lab
pnpm exec tsx -e 'import {cfg} from "@lab/runtime"; console.log(JSON.stringify({ordering:cfg.ORDERING_URL,fulfillment:cfg.FULFILLMENT_URL,operator:cfg.OPERATOR_URL}))' > .lab/recovery-origins.json
cat > .lab/interrupt-attempt.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
umask 077
ordering=$(jq -er '.ordering' .lab/recovery-origins.json)
fulfillment=$(jq -er '.fulfillment' .lab/recovery-origins.json)
operator=$(jq -er '.operator' .lab/recovery-origins.json)
api() { curl --fail-with-body -sS --max-time 5 "$@"; }
json=(-H 'Content-Type: application/json')
api -X PUT "$fulfillment/api/v1/settings" "${json[@]}" \
  -d '{"preset":"slow","paused":false}' > .lab/recovery-settings.json
api "$ordering/api/v1/products" "${json[@]}" \
  -d '{"name":"Restart specimen","description":"Fictional interrupted work","priceCents":100,"availableStock":1}' > .lab/recovery-product.json
product=$(jq -er '.data.id' .lab/recovery-product.json)
shopper=$(node -p 'crypto.randomUUID()')
api "$ordering/api/v1/carts" "${json[@]}" \
  -d "$(jq -nc --arg shopper "$shopper" '{shopperId:$shopper}')" > .lab/recovery-cart.json
cart=$(jq -er '.data.id' .lab/recovery-cart.json)
api -X PUT "$ordering/api/v1/carts/$cart/items/$product" "${json[@]}" \
  -d '{"quantity":1}' > .lab/recovery-item.json
api "$ordering/api/v1/carts/$cart/preview" > .lab/recovery-preview.json
jq --arg cart "$cart" '.data | {cartId:$cart,revision,priceFingerprint}' \
  .lab/recovery-preview.json > .lab/recovery-submission.json
node -p 'crypto.randomUUID()' > .lab/recovery-key.txt
api "$ordering/api/v1/checkouts" "${json[@]}" \
  -H "idempotency-key: $(cat .lab/recovery-key.txt)" \
  --data-binary @.lab/recovery-submission.json > .lab/recovery-order.json
order=$(jq -er '.data.id' .lab/recovery-order.json)
deadline=$((SECONDS + 20))
while :; do
  api "$fulfillment/api/v1/system" > .lab/recovery-system.json
  if jq -e --arg order "$order" \
    '.data.jobs[] | select(.orderId==$order and .status=="processing")' \
    .lab/recovery-system.json > .lab/recovery-job-before.json; then
    job=$(jq -er '.id' .lab/recovery-job-before.json)
    if jq -e --arg job "$job" \
      '.data.attempts[] | select(.jobId==$job and .status=="processing")' \
      .lab/recovery-system.json > .lab/recovery-attempt-before.json; then
      break
    fi
  fi
  if (( SECONDS >= deadline )); then
    echo 'No active attempt observed; inspect the recorded order before retrying.' >&2
    exit 1
  fi
  sleep 0.1
done
api "$operator/api/v1/actions" "${json[@]}" \
  -d '{"name":"stop"}' > .lab/recovery-stop-submission.json
action=$(jq -er '.data.id' .lab/recovery-stop-submission.json)
deadline=$((SECONDS + 180))
while :; do
  api "$operator/api/v1/actions/$action" > .lab/recovery-stop.json
  state=$(jq -er '.data.status' .lab/recovery-stop.json)
  if [[ "$state" == completed || "$state" == failed ]]; then break; fi
  if (( SECONDS >= deadline )); then
    echo 'Stop action still pending; inspect its saved ID, do not resubmit.' >&2
    exit 1
  fi
  sleep 0.5
done
jq -e '.data.status=="completed" and .data.cleanup.verified==true' .lab/recovery-stop.json
SH
bash .lab/interrupt-attempt.sh
./lab status
./lab resources
```

Require a completed stop with verified cleanup and all seven managed services observed off. Keep the saved order/job/attempt IDs, `startedAt`, `dueAt`, and stop action's requested/started/finished times in the ignored `.lab` evidence. If checkout times out, its outcome is unknown: recover the saved submission with the saved key rather than generating another order. If stop fails or times out, inspect that action before proceeding.

Restart with retained volumes, then verify the same attempt and the order. The next block polls for up to 30 seconds after startup readiness and exits on a failed assertion. It does not submit checkout again.

```sh
./lab start
./lab status
cat > .lab/check-resumed-attempt.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
umask 077
ordering=$(jq -er '.ordering' .lab/recovery-origins.json)
fulfillment=$(jq -er '.fulfillment' .lab/recovery-origins.json)
job=$(jq -er '.id' .lab/recovery-job-before.json)
order=$(jq -er '.data.id' .lab/recovery-order.json)
deadline=$((SECONDS + 30))
while :; do
  curl --fail-with-body -sS --max-time 5 "$fulfillment/api/v1/jobs/$job" > .lab/recovery-job-after.json
  curl --fail-with-body -sS --max-time 5 "$ordering/api/v1/orders/$order" > .lab/recovery-order-after.json
  if jq -e '.data.status=="fulfilled"' .lab/recovery-order-after.json >/dev/null; then break; fi
  if (( SECONDS >= deadline )); then echo 'Order did not fulfill before the deadline.' >&2; exit 1; fi
  sleep 0.25
done
jq -e --slurpfile before .lab/recovery-attempt-before.json \
  --slurpfile stopped .lab/recovery-stop.json '
  .data.attempts as $attempts |
  ($attempts | length)==1 and
  $attempts[0].id==$before[0].id and
  $attempts[0].startedAt==$before[0].startedAt and
  $attempts[0].status=="completed" and
  ($attempts[0].finishedAt | type)=="string" and
  ($stopped[0].data.finishedAt | type)=="string" and
  $attempts[0].finishedAt > $stopped[0].data.finishedAt
  ' .lab/recovery-job-after.json
curl --fail-with-body -sS --max-time 5 -X PUT "$fulfillment/api/v1/settings" \
  -H 'Content-Type: application/json' -d '{"preset":"success","paused":false}' > .lab/recovery-restored-settings.json
SH
bash .lab/check-resumed-attempt.sh
```

Both assertions must succeed: the order is fulfilled, and exactly one completed attempt retains its original ID and start time, with `finishedAt` later than the completed stop action. API timestamps use UTC ISO strings, so this comparison uses the common format. If the attempt completed before stop finished, the interruption was missed; do not count that run as recovery proof. Inspect the evidence, restore the success preset with `./lab preset fulfillment success` if the script exited early, and repeat with a new fictional order. The five-second preset cannot guarantee interruption on every host. These commands describe a reproducible exercise; their new shell form was checked separately from the dated physical run below.

The documented shell scripts passed Bash syntax checks and ShellCheck. A local HTTP fixture accepted the same persisted attempt and rejected six invalid cases: a replacement ID, an additional attempt, completion before stop, a missing completion time, a changed start time, and unverified stop cleanup. These fixture checks validate the command assertions; they do not establish another physical run or close the runtime-pin gap.

## 6. Stop and release the guest

Finish traffic and exercises first. From the application host:

```sh
./lab feeder stop
./lab experiment status
./lab stop
./lab resources
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
