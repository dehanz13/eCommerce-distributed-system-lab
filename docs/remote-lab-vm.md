# Dedicated remote lab guest

`infrastructure/ecommerce-lab.lima.yaml.template` defines a separate Lima guest named `ecommerce-lab`: Ubuntu 24.04 x86_64, four virtual CPUs, 4 GiB assigned memory and a 40 GiB sparse-disk limit. These are configured allocations, not measured peak usage. The template pins an Ubuntu image digest and installation package versions.

## Prepare the guest

Set `REMOTE_HOST`, `REMOTE_USER`, `REMOTE_DIR`, `REMOTE_VM=ecommerce-lab` and `REMOTE_BIND_IP` in the root `.env`. Use an existing SSH identity stored outside the checkout.

```sh
pnpm exec tsx tools/vm-template.ts
```

Transfer the generated `.lab/ecommerce-lab.yaml` privately to the remote host. It includes deployment-specific paths and addresses and is ignored by Git. On that host, inspect existing guests before creating a missing one:

```sh
limactl list
limactl start --name=ecommerce-lab --tty=false <generated-template-path>
```

The checkout is a writable virtiofs mount. Database and broker volumes are inside the guest. If a pinned installation package is no longer available, record and review a version change; do not silently install another version.

## Configure two-machine operation

Set `TOPOLOGY=two`. Configure PostgreSQL, RabbitMQ and Redis host fields to the reachable remote host. Set `TOXIPROXY_URL` to its port 8474 and `FULFILLMENT_URL` to port 4312. Keep ordering, operator and web on the application host. Reload the operator after changing configuration.

The operator projects configuration from the root `.env` and runs Compose through `limactl shell ecommerce-lab` when `REMOTE_VM` is set. An empty `REMOTE_VM` selects direct SSH execution on a Linux host. Moving hosts recreates and reseeds the lab; there is no business-data migration routine.

The template forwards ports 54329 (PostgreSQL), 56729 (direct AMQP), 56730 (AMQP proxy), 15629 (broker management), 4312 (fulfillment), 63729 (Redis) and 8474 (proxy administration) to the configured host address. Inspect connectivity and owner readiness after startup; template creation alone does not establish service readiness.

## Observe and stop

```sh
./lab monitor remote-host
./lab monitor lab-vm
```

The first command opens btop on the physical remote host; the second opens it inside the configured guest. Record those scopes separately. Unsupported sensor readings are unavailable rather than zero.

Use the [shutdown runbook](shutdown-and-cleanup.md) to stop only this guest, preserve its disk or deliberately remove it. No command in this runbook targets another project's guest or the host's default Docker context.
