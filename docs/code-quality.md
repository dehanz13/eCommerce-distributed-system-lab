# Quality checks and live-demo monitoring

Run `pnpm quality` for strict TypeScript checking, ESLint with TypeScript, React Hooks and JSX accessibility rules, Prettier verification, and Vitest V8 coverage. Run `pnpm build` separately. CI runs the same gates plus ShellCheck for executable scripts. Its separate ecosystem job bootstraps the disposable lab and runs integration, recovery and browser checks sequentially. Formatting and lint results are pass/fail: they do not have a meaningful quality percentage. Coverage reports lines, branches, functions, and statements; no artificial combined score is created.

`pnpm test:coverage` measures the entire configured application/package/tool scope, including untested files. It generates an HTML report in coverage/index.html and refreshes docs/badges/unit-coverage.svg. The checked-in badge is the latest committed local measurement. CI uploads a fresh report and badge as downloadable artifacts and reports exact percentages in the run summary. The current unit suite is small: integration tests and browser tests are separate correctness evidence, not included in this unit percentage. Establish measured thresholds as coverage grows; avoid writing redundant tests just to inflate the number.

The README's Code quality badge links to this repository's GitHub Actions workflow. For a live GitHub percentage badge, enable this repository in Codecov and add its upload token as the CODECOV_TOKEN repository secret. The workflow publishes coverage on trusted push/manual runs when configured. Once Codecov is connected and develop contains the merged workflow, this additional README badge can report its measured percentage:

```markdown
[![Coverage](https://codecov.io/gh/dehanz13/eCommerce-distributed-system-lab/branch/develop/graph/badge.svg)](https://codecov.io/gh/dehanz13/eCommerce-distributed-system-lab)
```

The public repository is [dehanz13/eCommerce-distributed-system-lab](https://github.com/dehanz13/eCommerce-distributed-system-lab). Inspect its Actions runs and release pull request for actual CI outcomes. Codecov remains optional and has not been connected by this change; the local measured coverage SVG works without it.

## Host observation with btop

Run `./lab monitor`, `./scripts/monitor` or `pnpm monitor` in a separate terminal on the machine being measured. It opens btop without stopping the lab. On macOS install with `brew install btop`. In a Debian/Ubuntu VM install with `sudo apt update` followed by `sudo apt install btop`. Other Linux distributions should use their package manager. The helper checks availability and does not install or change machine configuration.

Observe CPU, memory, disk, network, and process activity during seeded checkouts and failure/retry presets. Run btop on M3 for the frontend/backend host, on MBP19 macOS for the physical host, and inside its Linux VM for guest resource use. Guest figures do not prove physical-host usage. Hardware sensor/GPU measurements depend on platform support and permissions; record unavailable fields as unavailable. btop is an interactive observer, not a telemetry storage/export pipeline. Use the application dashboard for business activity and `docker stats --no-stream` for container measurements. Record sample time, machine, workload, and topology when comparing observations.

Sources: [Vitest coverage](https://vitest.dev/guide/coverage), [JSX accessibility rules](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y), [Codecov action](https://github.com/codecov/codecov-action), [btop](https://github.com/aristocratos/btop).
