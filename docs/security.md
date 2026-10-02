# Security and publication checks

This record describes scanner results and their limits. It does not establish production readiness or the absence of every vulnerability or identifying value. Scan data is in [security-snapshot.json](security-snapshot.json); critical/high container-package rows are in [security-findings.csv](security-findings.csv).

## Dependency audit

On October 2, 2026, `pnpm audit --json` reported one critical and two moderate advisories affecting Vitest and its mocker package. Vitest and its V8 coverage provider were updated together to 4.1.11. The subsequent audit reported zero advisories for the repository's installed workspace dependencies, including test tooling. Advisory data changes over time; rerun the command before publishing.

References: [test-server advisory](https://github.com/advisories/GHSA-5xrq-8626-4rwp), [redirect-mock advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

## File and history checks

Gitleaks 8.30.1 scanned reachable Git history across local refs, including merge diffs, with redacted output. It reported no configured secret-rule matches. The current-file policy checks tracked files and nonignored additions for private configuration/key files, home paths, email addresses requiring review, overlay-network addresses and documentation terminology. Its latest run reported no matches. Those checks are pattern-based; they do not prove that every possible credential or personal detail is absent.

The example configuration contains fictional passwords. Root configuration, generated projections, key material and runtime output are excluded by ignore rules. Staged files are checked before publication because an ignore rule does not remove already tracked content.

Historical source inspection found developer-local home paths in two documentation files across seven reachable commits. Current documentation uses generic paths. The original strings remain in published history; removing them requires a coordinated history rewrite. File-content checks do not audit Git author metadata or third-party lockfile metadata. A repository rewrite also cannot establish deletion of previously copied or cached material.

## Container-package audit

Trivy 0.75.0 scanned the six pinned service/base-image references on `linux/arm64`. The advisory database timestamp and report hashes are recorded in the JSON snapshot. PostgreSQL was refreshed to 18.6, RabbitMQ to 4.2.9 and the Node base to 24.21.0, with fixed digests. Redis and proxy references were retained. The table is the recorded result after these reference updates.

| Component         | Critical | High | Medium | Low | Unknown |
| ----------------- | -------: | ---: | -----: | --: | ------: |
| postgres          |        1 |   21 |     22 |   2 |       1 |
| rabbitmq          |        0 |    0 |      0 |   0 |       0 |
| redis             |        0 |    0 |      0 |   0 |       0 |
| toxiproxy         |        2 |   44 |     64 |   6 |       2 |
| node-service-base |        4 |   60 |    113 |  76 |       2 |
| browser-test-base |        3 |   49 |   1140 | 191 |       0 |

Remaining PostgreSQL findings are in the bundled Go helper; proxy findings are in its Go standard library. Node and browser-base findings include operating-system packages and bundled package-manager dependencies. These counts are package-level advisory matches, not confirmed application exploit paths. They include findings without an available patched version. The row data records available fixes without assuming that changing a package version makes a complete image safe.

The browser row scans the upstream test base, not the final layered browser image. Final application images, other architectures, physical-host packages, SSH configuration and guest installation state were not audited by these commands. Zero repository npm advisories does not cover packages bundled in a container's global tools.

## Commands and CI scope

```sh
pnpm check:public
pnpm audit --audit-level=low
pnpm security
pnpm security:images
```

`pnpm security` requires gitleaks and combines the current-file policy, repository dependency audit and redacted Git-history scan. CI installs gitleaks from a pinned release archive and checks its SHA-256 before use. Its **Dependency and publication checks** job runs this command.

`pnpm security:images` requires Trivy, reads pinned references from Compose and both Dockerfiles, and returns a nonzero exit for high/critical findings or scan failures. Given the recorded findings, this command is expected to fail until those images are remediated. Image scanning is separate from the npm/history CI job and coverage badge. It downloads advisory data and image layers; its first run needs network access and local cache capacity.

Before pushing, review staged filenames, run `pnpm security`, scan the staged changes with `gitleaks git --pre-commit --staged --redact`, and inspect the image audit when references change. Keep scan output redacted and avoid publishing generated configuration, process logs or raw host details.
