# Branch and release workflow

Repository: [dehanz13/eCommerce-distributed-system-lab](https://github.com/dehanz13/eCommerce-distributed-system-lab).

`develop` is the default integration branch. Release branches are reviewed through pull requests targeting it. A pushed branch is separate from a reviewed merge and from a running local deployment.

To clone the current integration branch:

```sh
git clone --branch develop https://github.com/dehanz13/eCommerce-distributed-system-lab.git
cd eCommerce-distributed-system-lab
```

For a subsequent release, start from the current integration branch:

```sh
git switch develop
git pull --ff-only origin develop
git switch -c release/0.2.0-next-slice
```

Choose a release name matching the actual planned slice. Commit changes and push that release branch, then open its pull request with base `develop`. Review and merge remain explicit steps; pushing a branch does not merge it or deploy the application.

Before committing, run `pnpm security` and review staged content. Run the remaining checks relevant to the change. For a full release, run `pnpm quality`, `pnpm build`, and ShellCheck for executable scripts. Verify the running disposable ecosystem through integration, recovery, learning and browser checks sequentially. CI repeats those gates on Ubuntu and records the outcomes on the pull request; local results and CI results are separate evidence.

The source, migrations, lockfile, container definitions and shared documentation are tracked. `.env`, generated runtime state, dependencies/builds, test output, macOS metadata and personal root guidance are excluded. Review staged files before uploading. Keep the committed `.env.example` values fictional and configure real host settings only in the ignored `.env`.

No service deployment is part of this Git workflow. Start and stop the lab through the [operation guide](operations.md) and [shutdown runbook](shutdown-and-cleanup.md).
