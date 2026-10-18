# Releasing epic-board

This document is for maintainers. It covers the one-time repository setup, the
self-hosted runner, the release procedure and how users install and verify releases.

## CI overview

| Workflow | Trigger | Runner |
|---|---|---|
| `ci.yml` → `test` | pull requests, push to `main` | GitHub-hosted, Ubuntu + macOS × Node 22, 24 |
| `ci.yml` → `validate-plugin` | pull requests, push to `main` | GitHub-hosted Ubuntu, `claude plugin validate --strict .` |
| `ci.yml` → `selfhosted-smoke` | push to `main` only | self-hosted `[self-hosted, linux, epic-board]` |
| `release.yml` | push of a `v*.*.*` tag | self-hosted |
| `codeql.yml` | pull requests, push to `main`, weekly | GitHub-hosted |

No workflow in this repository sends pull requests to the self-hosted runner, and none uses
`pull_request_target`. That alone does not protect the host: a pull request runs *its own*
copy of the workflows, so a fork can add `runs-on: [self-hosted, …]`. What actually keeps fork
code off the runner is the setting below that requires approval for outside contributors —
never approve a run for a pull request that touches `.github/` without reading it. The runner is
persistent, so code that once ran there could tamper with later release jobs; if that ever
happens, wipe the host and register a new runner. Every workflow defaults to `contents: read` and elevates per job.
Third-party actions are pinned by commit SHA; Dependabot proposes updates weekly.

`npm run check` runs `scripts/release/check-versions.mjs` (all manifests agree, CHANGELOG
has a dated section) and `scripts/release/privacy-scan.mjs` (no home paths, personal
emails, private keys or tokens in tracked files; add `privacy-scan: allow` to a line that
is intentionally public).

## One-time repository settings

Settings → Actions → General:

- Fork pull request workflows from outside collaborators: **Require approval for all outside collaborators**.
- Workflow permissions: **Read repository contents and packages permissions**.
- **Allow GitHub Actions to create and approve pull requests**: off.

Settings → Rules → Rulesets (or Branches → Branch protection):

- Branch `main`: require a pull request and a review from code owners (`.github/CODEOWNERS` covers `.github/workflows/`), require status checks to pass
  (`test (…)` matrix entries, `validate plugin manifests`, `analyze (javascript-typescript)`),
  block force pushes and deletions.
- Tag ruleset for `v*`: restrict creation, update and deletion to maintainers; block
  force pushes. Only maintainers can then trigger `release.yml`.

Settings → Advanced Security (Code security):

- **Private vulnerability reporting**: on.
- **Dependabot alerts**: on. Dependabot security updates: on.
- CodeQL runs from `codeql.yml`; leave default setup off to avoid duplicate analyses.

## Self-hosted runner

The runner is a dedicated Ubuntu 22.04 or 24.04 host (x64 or arm64). The script installs
git, curl, jq, Node 22 (checksum-verified from nodejs.org), `gh` from the official apt
repository and a pinned, checksum-verified `actions/runner`. Jobs run as the system user
`gh-runner` (home `/opt/gh-runner`, no sudo) under a systemd service.

On a machine with `gh` logged in as a maintainer:

```sh
RUNNER_TOKEN=$(gh api -X POST repos/k-semenko/epic-board/actions/runners/registration-token --jq .token)
scp scripts/runner/setup-runner.sh runner-host:/tmp/
printf '%s\n' "$RUNNER_TOKEN" | ssh runner-host "sudo bash /tmp/setup-runner.sh --token-stdin"
```

Or directly on the runner host, from a pinned tag:

```sh
curl -fsSLO https://raw.githubusercontent.com/k-semenko/epic-board/vX.Y.Z/scripts/runner/setup-runner.sh
less setup-runner.sh   # review before running as root
sudo RUNNER_TOKEN=<token> RUNNER_NAME=epic-board-1 bash setup-runner.sh
```

The registration token is valid for one hour. Re-running the script is safe: it skips
steps that are already done.

Self-update of the runner is disabled. When GitHub publishes a new `actions/runner`
version, update `RUNNER_VERSION` and both `RUNNER_SHA256_*` values in the script from the
release notes, then re-run it on the host. GitHub stops dispatching jobs to runners that
are too far behind.

To remove the runner:

```sh
RUNNER_TOKEN=$(gh api -X POST repos/k-semenko/epic-board/actions/runners/remove-token --jq .token)
ssh -t runner-host "sudo RUNNER_TOKEN=$RUNNER_TOKEN bash /tmp/setup-runner.sh --uninstall"
```

## Release procedure

1. Bump the version to `X.Y.Z` in all of:
   - `package.json` → `version`
   - `.claude-plugin/plugin.json` → `version`
   - `.claude-plugin/marketplace.json` → `plugins[0].version` and `metadata.version`, if present
   - `.cursor-plugin/plugin.json` → `version`
   - `.cursor-plugin/marketplace.json` → `plugins[0].version` and `metadata.version`, if present
2. In `CHANGELOG.md`, move the `[Unreleased]` entries under `## [X.Y.Z] - YYYY-MM-DD`.
3. Check locally:

   ```sh
   npm test
   npm run check
   claude plugin validate --strict .
   ```

4. Merge the release PR into `main` and wait for CI to pass.
5. Tag and push from the merged `main`:

   ```sh
   git switch main && git pull --ff-only
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

`release.yml` then verifies the tag against all versions and the CHANGELOG, runs the
tests and checks, builds `epic-board-vX.Y.Z.tar.gz` (a `git archive` of the tag without
`.github/`, `test/` and this document) with `SHA256SUMS`, attests build provenance and
creates the GitHub release with the CHANGELOG section as notes. A version with a
pre-release suffix (`vX.Y.Z-rc.1`) is published as a pre-release.

If the workflow fails before the release is created, fix the problem, delete the tag
(`git push origin :refs/tags/vX.Y.Z`, `git tag -d vX.Y.Z`) and tag again.

To build the tarball locally: `npm run pack` (writes to `dist/`).

## Installing, pinning and updating the plugin

In Claude Code:

```text
/plugin marketplace add k-semenko/epic-board
/plugin install epic-board@epic-board
```

Pin to a release by adding the marketplace at a tag:

```text
/plugin marketplace add k-semenko/epic-board#vX.Y.Z
```

Update to the latest version:

```sh
claude plugin update epic-board@epic-board
```

Automatic updates are toggled per marketplace in `/plugin` → **Marketplaces**.

## Verifying a downloaded release

```sh
gh release download vX.Y.Z --repo k-semenko/epic-board
sha256sum -c SHA256SUMS          # macOS: shasum -a 256 -c SHA256SUMS
gh attestation verify epic-board-vX.Y.Z.tar.gz --repo k-semenko/epic-board
```

The attestation proves that the tarball was built by `release.yml` in this repository
from the tagged commit.
