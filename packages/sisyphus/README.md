<p align="center">
  <img src="https://raw.githubusercontent.com/r5n-labs/clis/develop/packages/sisyphus/assets/logo.svg" width="128" alt="Sisyphus logo — a boulder resting on a slope">
</p>

# Sisyphus

Monorepo versioning and release tool. Pending changes are recorded as "stones" (JSON files in `.sisyphus/stones/`, in the spirit of changesets); rolling them bumps versions, writes changelogs, tags, publishes, and pushes in one step.

[![npm](https://img.shields.io/npm/v/@r5n/sisyphus.svg)](https://www.npmjs.com/package/@r5n/sisyphus) [![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

The binary is `sisyphus`, with `sis` as a short alias. Sisyphus runs on [Bun](https://bun.sh) and discovers packages from the `workspaces` globs in your root `package.json`.

## Install

```bash
bun add -g @r5n/sisyphus
```

Or add it as a dev dependency and run it with `bunx @r5n/sisyphus`.

## Quick start

```bash
sisyphus init
sisyphus version
sisyphus check
sisyphus roll
```

`init` writes `.sisyphus/config.json` (flag-driven; an interactive form lives in the `sis -i` menu). `version` with no arguments prompts you to pick packages per bump type and enter a message, then writes a stone. `check` shows workspace packages and what each pending stone will release. `roll` merges all pending stones, applies the version bumps, and deletes the stones.

By default `roll` only updates files and creates the release commit. Publishing, tagging, pushing, and provider releases are opt-in via flags or the `release` section of the config.

## Commands

### `sisyphus version`

Create a stone. Interactive when run without positionals; non-interactive with a message and package lists:

```bash
# Interactive
sisyphus version

# Apply one bump to every filtered package without prompts
sisyphus version --bump minor --all --filter @org/core --message "feat: update core" --yes

# Assign packages to bump groups without prompts
sisyphus version --minor @org/core,@org/api --patch @org/utils --message "feat: update workspace" --yes

# Generate stones from conventional commits
sisyphus version --fromCommits --filter @org/core --dryRun

# Create a tagged prerelease stone
sisyphus version --bump patch --all --filter @org/core --message "fix: beta repair" --tag beta --yes
```

**Options:**
- `-a, --all` — Select every filtered package (requires `--bump`)
- `-b, --bump` — Apply `major`, `minor`, or `patch` to every selected package
- `-d, --dry-run` — Preview without writing stones
- `-f, --filter` — Constrain interactive choices, explicit package lists, or commit analysis by package name
- `--fromCommits` — Generate stones from conventional commits instead of manual selections
- `-M, --major` — Comma-separated packages receiving a major bump
- `--message` — Stone message; required for non-interactive manual selection
- `-m, --minor` — Comma-separated packages receiving a minor bump
- `-p, --patch` — Comma-separated packages receiving a patch bump
- `-t, --tag` — Prerelease tag (alpha, beta, rc, etc.)
- `-y, --yes` — Skip confirmation

Packages that depend on the bumped ones are picked up automatically and get a dependency (patch-level) bump.

The message and optional description can also be supplied as positional arguments. Do not combine a positional message
with `--message`.

### `sisyphus check`

Show the root package, workspace packages, and pending stones with the versions they will produce. `--json` for machine-readable output (used in CI), `-c, --config` to include the resolved config.

### `sisyphus stone`

Manage pending stones: `list` (`-j`, `-v`), `show <id>` (`-j`), `edit <id> -m "new message"`, `merge <id...> -m "message"` (`-d` deletes the originals; conflicting bumps resolve to the highest), `delete <id>`. Subcommands prompt for a stone when no id is given.

### `sisyphus roll`

Execute a release from all pending stones: bump versions, generate changelogs, delete the stones, commit, then optionally tag, push, publish, and create provider releases. Failures before an external operation roll back the commit, tags, file changes, and stones. Once an external operation starts, local state and a durable release ledger are preserved so the release can be reconciled and resumed.

```bash
sisyphus roll --dryRun
sisyphus roll -n -t -p -y
sisyphus roll --resume
```

- `-c, --changelog` — generate changelogs (default from `changelog.generate`)
- `-n, --npm` — publish to npm (default from `release.npm`)
- `-t, --tags` — create `name@version` git tags (default from `release.tags`)
- `-p, --push` — push commits and tags (default from `release.push`)
- `-r, --createRelease` — create a release on the git provider (default from `release.createRelease`)
- `--noCommit` — skip the release commit (also disables tags, push, and provider release)
- `--preview` — write changelogs, show them, then offer to revert
- `--publishOnly` — publish from `currentRelease` recorded by `actions release-pr`, without touching files
- `--resume` — reconcile and continue the active incomplete release
- `-d, --dryRun`, `-y, --yes`

Provider releases require tags to be pushed to the same repository first, so normal releases must enable `--tags --push --createRelease`; publish-only releases require `--tags --createRelease` and push those exact tags before creating releases.

Publishing builds each public package, rewrites its `package.json` to a clean publish manifest, and packs an immutable tarball before any package is uploaded. `workspace:` specifiers are resolved against actual workspace versions (`workspace:*` pins the exact version and `workspace:^`/`workspace:~` become ranges), `catalog:` specifiers are resolved from the root `catalog`/`catalogs`, and `devDependencies` are stripped. The source manifest is restored after packing, even if preparation fails. Private packages (`"private": true`) are skipped.

For releases with external operations, Sisyphus stores the plan, immutable artifacts, exact Git refs, and per-operation progress below Git's worktree-specific administrative directory. `--resume` verifies an ambiguous npm upload by SHA-512 integrity, verifies an ambiguous push from exact remote refs, and verifies provider releases by tag, title, and notes. If the external system cannot confirm the expected state, resume stops rather than repeating the operation.

Npm publication requires a release commit, so it cannot be combined with `--noCommit`. Publish-only releases verify the source hash recorded by `actions release-pr`, the exact package versions, and the complete archived-stone set before creating tags or artifacts.

### `sisyphus pr`

Create a stone from a pull request (GitHub via the `gh` CLI, which must be installed and authenticated). Reads title, body, labels, commits, and changed files; the bump type comes from labels via `pr.labelMapping`, the title, `-b/--bump`, or a prompt. PRs matching `pr.skip` (labels, authors, title patterns) are ignored.

```bash
sisyphus pr -u https://github.com/org/repo/pull/123 -y
```

### `sisyphus migrate`

Convert an existing `.changeset/` directory to stones and map supported changeset config (`ignore`, `commit`, `access`, `changelog`) onto the Sisyphus config. `-d, --dryRun`, `-y, --yes`.

### `sisyphus actions`

CI integration. `actions init` detects your provider (GitHub Actions or GitLab CI) and installs workflow templates: a create-stone workflow that turns merged PRs into stones and maintains a release PR, and a release workflow that publishes when the release PR merges (`--all`, `--createStone`, `--release`, `-d`, `-y`). `actions release-pr` creates or updates the `sisyphus/release` branch and PR from pending stones, archives the stones to `.sisyphus/released/<timestamp>/`, and records `currentRelease` in the config for a later `roll --publishOnly`.

### `sisyphus init`

Create or edit `.sisyphus/config.json`. Flag-driven when invoked directly (the interactive form lives in the `sis -i` menu); every form field has a matching flag (`--single`, `--tag`, `--npm`, `--tags`, `--push`, `--createRelease`, `--changelog`, `--rootChangelog`, `--commitAuthor`, `--commitEmail`, `--commitMessage`). `--default` resets to defaults, `--force` overwrites non-interactively. Also records the current HEAD as `lastStone`, the baseline for `version --fromCommits`.

## Configuration

`.sisyphus/config.json`, created by `init` (trimmed excerpt — `init` writes the full default set, including an extended `pr.labelMapping` and commit-skip patterns):

```json
{
  "$schema": "https://raw.githubusercontent.com/r5n-labs/clis/refs/heads/develop/packages/sisyphus/schema.json",
  "single": false,
  "tag": "latest",
  "commit": {
    "author": "r5n-bot",
    "message": "chore(release): {message}"
  },
  "changelog": {
    "generate": true,
    "root": false,
    "append": true,
    "filename": "CHANGELOG.md",
    "packageHeader": "{emoji} {version} ({date})",
    "rootHeader": "{date} - {packages}"
  },
  "release": {
    "npm": false,
    "tags": false,
    "push": false,
    "createRelease": false
  },
  "commits": {
    "skip": {
      "authors": ["r5n-bot[bot]"],
      "messagePatterns": ["^chore\\(release\\):"]
    }
  },
  "pr": {
    "labelMapping": { "breaking": "major", "feature": "minor", "fix": "patch" },
    "skip": {
      "labels": ["sisyphus-release", "skip-stone"],
      "authors": ["r5n-bot[bot]"],
      "titlePatterns": ["^chore\\(release\\):"]
    }
  }
}
```

- `single` — version the root package instead of workspace packages
- `tag` — npm dist-tag used when publishing
- `commit` — release commit author/email and message template; `{message}` and `{packages}` are substituted
- `changelog` — `sections` maps conventional commit types (`feat`, `fix`, `breaking`, ...) to headings; `root` adds a combined root changelog; `packageHeader`/`rootHeader` support `{emoji}`, `{version}`, `{date}`, `{packages}`
- `commits.skip` / `pr.skip` — filters for `version --fromCommits` and `pr`
- `release` — defaults for the corresponding `roll` flags
- `sisyphusDir` / `stonesPath` — relocate the config directory or stone storage
- `lastStone`, `stones`, `currentRelease` — managed by the CLI; don't edit by hand

## Stones

Each stone is a JSON file at `.sisyphus/stones/<id>.json`, safe to commit and review:

```json
{
  "id": "0001-741d2bed",
  "message": "feat: add auth",
  "description": "Optional longer notes",
  "minor": ["@org/auth"],
  "patch": ["@org/api"],
  "dependency": ["@org/app"]
}
```

Stones may also carry a `tag` (prerelease) and the `commits` they were generated from. `roll` merges every pending stone, keeping the highest bump per package.

## GitHub Actions

A push-based release job, modeled on this repo's own workflow: roll whenever pending stones land on the main branch. Uses npm trusted publishing (OIDC), which needs `id-token: write` and npm >= 11.5.1, plus each package configured for trusted publishing on npmjs.com. If you don't use OIDC, `roll` publishes with plain `npm publish`, so a granular token in `~/.npmrc` (via `NPM_TOKEN`) works too.

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    if: "!startsWith(github.event.head_commit.message, 'chore(release):')"
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: npm install -g npm@11
      - name: Check for pending stones
        run: |
          COUNT=$(bunx @r5n/sisyphus check --json | jq '.stones | length')
          echo "STONES_COUNT=$COUNT" >> "$GITHUB_ENV"
      - name: Roll release
        if: env.STONES_COUNT != '0'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          bunx @r5n/sisyphus roll --yes
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

On self-hosted runners, set `NPM_CONFIG_PROVENANCE: "false"` on the roll step; provenance generation only works on GitHub-hosted runners. For the PR-driven flow (stone per merged PR, rolling release PR, publish on merge), run `sisyphus actions init` and commit the generated workflows instead.

## Requirements

- Bun (the CLI is a Bun executable)
- git, with a `workspaces` field in the root `package.json` (unless `single`)
- `gh` CLI, authenticated, for GitHub PR and release operations (`pr`, `actions release-pr`, `roll --createRelease`); GitLab is supported via `GITLAB_TOKEN` or `glab`

## License

Apache 2.0 — see [LICENSE](./LICENSE)
