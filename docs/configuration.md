# Configuration

Copy `.env.example` to the ignored root `.env` during first setup. Preserve an existing file. The shared loader reads that file for backend services, terminal tools and frontend build/start configuration. It does not merge arbitrary shell variables into the editable source. The operator generates service-specific projections under `.lab/` for remote containers and isolated browser checks.

## Required values

All non-optional keys in `.env.example` must be present and nonblank. This includes topology, database host/port/accounts, database names, broker host/ports/account, cache host/port, service URLs and proxy URL. The example passwords are fictional lab defaults.

| Setting                                    | Validation or behavior                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `TOPOLOGY`                                 | `single` or `two`                                                                  |
| Dependency ports                           | Integers from 1 through 65535                                                      |
| Service and proxy URLs                     | HTTP origins without embedded credentials, paths, query parameters or fragments    |
| Application URLs                           | Include a non-default listening port from 1 through 65535; port zero is rejected   |
| `RABBIT_CONNECT_HOST`                      | May be blank; uses `RABBIT_HOST` for the AMQP proxy connection                     |
| `REMOTE_HOST`, `REMOTE_USER`, `REMOTE_DIR` | Required in two-machine mode; SSH operations also check their command-safe formats |
| `REMOTE_VM`                                | Optional for direct remote Linux operation; required by the guest-monitor command  |
| `REMOTE_BIND_IP`                           | Required when generating the Lima guest template                                   |

Missing required fields are reported together. The loader writes a message to stderr and throws before service startup. It reports variable names and corrective instructions, never supplied values. A missing or unreadable file is reported as a root configuration-file error.

`ORDERING_URL`, `FULFILLMENT_URL`, `OPERATOR_URL` and `WEB_URL` must retain a port after URL parsing because lifecycle commands use that port to start and inspect the processes. Origins without a port, `http://host:80` and `https://host:443` are rejected: URL parsing removes default ports. `TOXIPROXY_URL` is an HTTP destination and can use its protocol's default port.

Example terminal output:

```text
[configuration] .env: missing PG_HOST; missing ORDERING_PASSWORD. Check the root .env against .env.example.
```

`./lab` reports a missing file and exits. `scripts/bootstrap` explicitly creates a missing file from the example and prints that it did so. It does not replace an existing file.

## Apply a change

1. Stop the lab before changing topology or host ownership.
2. Edit the root `.env` and compare its keys with `.env.example`.
3. Reload the operator with `./lab reload-operator`.
4. Restart the affected applications. Restart web to rebuild proxy destinations.
5. Run `./lab status` and inspect action outcomes.

Changing database initialization accounts on existing volumes does not update existing database users. Recreate the disposable lab data deliberately when changing those settings.

## Where to look

Configuration errors appear in the terminal that launched the command. Child-process startup diagnostics are in `.lab/<service>.stdout.log`; the operator's failed action identifies the relevant file. A rejected remote command names missing remote variables. Dependency connectivity failures after valid configuration appear in readiness, activity and action results.

Keep SSH identities and host configuration outside the repository. Generated projections can contain credentials and host details, so `.env*`, `.lab/`, key material and runtime output are excluded from publication. `.env.example` is the committed exception and must contain fictional values.
