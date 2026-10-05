# Command reference

[Sisyphus](../README.md) / Command reference

## `sisyphus version`

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
- `-d, --dryRun` — Preview without writing stones
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

## `sisyphus check`

Show the root package, workspace packages, and pending stones with the versions they will produce. `--json` for machine-readable output (used in CI), `-c, --config` to include the resolved config.

## `sisyphus stone`

Manage pending stones: `list` (`-j`, `-v`), `show <id>` (`-j`), `edit <id> -m "new message"`, `merge <id...> -m "message"` (`-d` deletes the originals; conflicting bumps resolve to the highest), `delete <id>`. Subcommands prompt for a stone when no id is given.

## `sisyphus roll`

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
- `--preview` — write changelogs, list their paths, then offer to revert; `--yes`, `--json` and non-interactive runs automatically restore the original files
- `--publishOnly` — publish from `currentRelease` recorded by `actions release-pr`, without touching files
- `-j, --json` — print a machine-readable release report on stdout instead of the interactive output; the report carries a required `warnings` string array listing ignore exclusions, cycle-order caveats, channel problems, and npm versions not yet visible within `release.npmVisibilityTimeout`; each package reports `visible` as `true`, `false`, or `null` when unchecked
- `--resume` — reconcile and continue the active incomplete release
- `--abort` — abandon the incomplete release if nothing external has started; releases with external progress must use `--resume`
- `-d, --dryRun`, `-y, --yes`

Provider releases require tags to be pushed to the same repository first, so normal releases must enable `--tags --push --createRelease`; publish-only releases require `--tags --createRelease` and push those exact tags before creating releases.

Publishing builds each public package, rewrites its `package.json` to a clean publish manifest, and packs an immutable tarball before any package is uploaded. `workspace:` specifiers are resolved against actual workspace versions (`workspace:*` pins the exact version and `workspace:^`/`workspace:~` become ranges), `catalog:` specifiers are resolved from the root `catalog`/`catalogs`, and `devDependencies` are stripped. The source manifest is restored after packing, even if preparation fails. Private packages (`"private": true`) are skipped.

Publication defaults to public access and honours `publishConfig.access: "restricted"` from the immutable package manifest. Invalid access values fail before publication.

For releases with external operations, Sisyphus stores the plan, immutable artefacts, exact Git refs, and per-operation progress below Git's worktree-specific administrative directory. `--resume` verifies an ambiguous npm upload by SHA-512 integrity, verifies an ambiguous push from exact remote refs, and verifies provider releases by tag, title, and notes. If the external system cannot confirm the expected state, resume stops rather than repeating the operation. Resume runs from the recorded release commit; when HEAD is still the release's base commit with no tracked changes, as in a fresh CI checkout with a restored ledger, it checks out the release commit (detached) first.

Npm publication requires a release commit, so it cannot be combined with `--noCommit`. Publish-only releases verify the source hash recorded by `actions release-pr`, the exact package versions, and the complete archived-stone set before creating tags or artefacts.

## `sisyphus pr`

Create a stone from a pull or merge request (GitHub via authenticated `gh`; GitLab via `GITLAB_TOKEN` or `glab`). Reads title, body, labels, commits, and changed files; the bump type comes from labels via `pr.labelMapping`, the title, `-b/--bump`, or a prompt. Explicit `--bump` accepts `major`, `minor`, or `patch`. PRs matching `pr.skip` (labels, authors, title patterns) are ignored.

Provider file analysis preserves both sides of renames. It stops before writing a stone when it cannot establish a complete file list, including GitHub's [3,000-file response limit](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files) and [GitLab overflow responses](https://docs.gitlab.com/api/merge_requests/#retrieve-merge-request-changes).

```bash
sisyphus pr -u https://github.com/org/repo/pull/123 -y
```

## `sisyphus migrate`

Convert an existing `.changeset/` directory to stones and map supported changeset config (`ignore`, `commit`, `access`, `changelog`) onto the Sisyphus config. `-d, --dryRun` previews without writing; non-interactive migration requires `-y, --yes`.

## `sisyphus actions`

CI integration. `actions init` detects your provider (GitHub Actions or GitLab CI) and installs workflow templates: a create-stone workflow that turns merged PRs into stones and maintains a release PR, and a release workflow that publishes when the release PR merges (`--all`, `--createStone`, `--release`, `-d`, `-y`). `actions release-pr` creates or updates the `sisyphus/release` branch and PR from pending stones, archives the stones to `.sisyphus/released/<timestamp>/`, and records `currentRelease` in the config for a later `roll --publishOnly`.

Run `actions release-pr` from a clean working tree; commit or stash local changes first. It restores the original branch or detached checkout after preparing or previewing the release PR. `--dryRun` previews the fetched base without creating or resetting the local release branch.

The generated GitLab workflows require `GITLAB_TOKEN` with API access and repository write permission; `SIS_PUSH_TOKEN` can supply a separate repository write credential. They configure a credential-free origin URL and a credential helper for both stone and release-branch pushes. Automatic MR detection expects GitLab's standard merge commit title and `See merge request <project>!<number>` footer. Use merge commits for release merge requests; squash, rebase and custom commit messages require adapting the rules or running the release job manually.

The generated release workflows keep the recovery ledger between attempts, so retrying a failed release job resumes it. GitHub caches the ledger per workflow run; re-run the failed job rather than starting a new run. GitLab clones afresh and caches the ledger per commit with `when: always`, skipping the upload when the ledger holds no release; retries on a different runner need a [distributed runner cache](https://docs.gitlab.com/runner/configuration/autoscale/#distributed-runners-caching), otherwise only the runner that saved the ledger can restore it.

## `sisyphus init`

Create or edit `.sisyphus/config.json`. Flag-driven when invoked directly (the interactive form lives in the `sis -i` menu); every form field has a matching flag (`--single`, `--tag`, `--npm`, `--tags`, `--push`, `--createRelease`, `--changelog`, `--rootChangelog`, `--commitAuthor`, `--commitEmail`, `--commitMessage`). `--default` resets to defaults, `--force` overwrites non-interactively. Also records the current HEAD as `lastStone`, the baseline for `version --fromCommits`.
