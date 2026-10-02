# Dedicated MBP19 lab VM

The lab uses a separate Lima `ecommerce-lab` Ubuntu 24.04 x86_64 guest: 4 virtual CPUs, 4 GiB allocation and a 40 GiB sparse disk limit. The existing `hearso-backend` VM remains separate. This is an allocated capacity, not a performance guarantee. btop and operating-system readings must be scoped to macOS, guest, container and process.

See the [shutdown, cleanup and restart runbook](shutdown-and-cleanup.md) to free guest resources, optionally erase its disk, and resume the lab without touching Hearso.

`infrastructure/ecommerce-lab.lima.yaml.template` pins the Ubuntu image digest and the installed Docker/Compose/btop package versions observed during setup. Configure `REMOTE_HOST`, `REMOTE_USER`, `REMOTE_DIR`, `REMOTE_VM=ecommerce-lab`, and `REMOTE_BIND_IP` in root `.env`, then run `pnpm exec tsx tools/vm-template.ts`. Transfer the generated `.lab/ecommerce-lab.yaml` to MBP19 and run `limactl start --name=ecommerce-lab --tty=false <template-path>` there. Only create a missing VM; inspect an existing one rather than replacing it. If a pinned apt package is no longer available, fail and record a deliberate version update.

The checkout directory is a writable virtiofs mount. Database/broker/cache volumes live inside this dedicated VM. Compose operations run through `limactl shell ecommerce-lab`, never MBP19's default Docker context (which currently points at Hearso). Application projections are generated from root `.env` during remote deployment.

For two-machine mode set `TOPOLOGY=two`, PG/Rabbit/Redis hosts to the MBP19 tailnet host, `TOXIPROXY_URL` to that host's port 8474, and `FULFILLMENT_URL` to that host's port 4312. Keep ordering, operator and web URLs on M3. Restart operator after editing the source configuration, then start the lab. Moving hosts recreates/reseeds the lab; it does not migrate business data.

Ports forwarded to the configured tailnet address: 54329 PostgreSQL, 56729 direct AMQP, 56730 lab AMQP proxy, 15629 Rabbit management, 4312 fulfillment, 63729 Redis, and 8474 proxy administration. The explicit 56730 forward is included in the verified guest configuration. Stop only this guest if its Lima YAML needs editing; Hearso remains running. Do not blindly use MBP19's default Docker CLI.

Live demo monitoring:

```sh
ssh -t <configured-MBP19-host> btop
ssh -t <configured-MBP19-host> 'limactl shell ecommerce-lab btop'
```

Capture baseline, during shopper traffic and after restoration separately. Guest available memory is reclaimable-capacity information; free memory excludes cache. macOS swap use can persist after pressure subsides, so a single snapshot is not a load benchmark or a promise that larger VM allocations are safe.
