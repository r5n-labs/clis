# @r5n/sisyphus

## 🐛 0.9.1 (2026-08-03)

### 🪨 Bug fixes

- [`3c1c836`](https://github.com/r5n-labs/clis/commit/3c1c836) fix: close post-release review findings across core, atlas, tools, and sisyphus
  <details>
  <summary>Details</summary>

  Applies every actionable finding from the post-merge reviews of the
  #29-#34 stack.
  
  sisyphus:
  - release-pr stages release-owned files before hashing, so newly created
    changelogs hash as tracked and publish-only no longer wedges on the
    recorded sourceHash; the committed tree carries the exact hashed state.
  - sis version routes on a real TTY, so flag-only invocations fail fast in
    CI instead of opening the package multiselect, and a terminal session
    prompts for a missing message; sis pr intersects each commit's coverage
    with the selected packages so narrowed stones no longer consume other
    packages' commits; corrupt stone files fail with the file path named;
    snapshot labels render the pinned version; schema drops nested required
    arrays that contradicted deep-merged partial configs; roll snapshots
    the config via ConfigManager.path; --abort documented.
  - Templates: ledger cache re-keyed sha-free so workflow_dispatch recovery
    restores the ledger and resumes; checkout pins the merge commit; ledger
    paths resolved via git rev-parse; GitLab keeps non-443 ports and fails
    loudly on a missing NPM_TOKEN. The repo workflow resumes an active
    ledger instead of dying at the active-release guard.
  
  core: the run() catch now covers the interactive path; interactive-menu
  Exits render cause chains via a shared helper; repeated flags report the
  canonical long name; Exit's default exit code and cause rendering are
  documented.
  
  atlas: multiline single-quoted and backtick dotenv values parse with Bun
  parity; env-file parse errors name the file; run rejects swallowed global
  flags with the passthrough hint; export validates --profile like run and
  refuses --stdout with --out; deliberate parser divergences documented.
  
  tools: failure reports include captured stderr/stdout; the manifest is
  restored even when re-reading it fails; concurrent-change aborts name the
  recovery command; a failed restore also removes the packed artifact; dead
  tag option deleted; tools joins the type-check fan-out with its own
  tsconfig; argument parsing gains tests and fixtures ignore global git
  signing config.
  
  Full suite: 640 tests pass (was 590), type-check clean across all five
  workspaces, builds pass.
  </details>

## ✨ 0.9.0 (2026-07-28)

### 🪨 feat: harden profile and release workflows

<details>
<summary>Description</summary>

  Release commits now require a valid commit.email whenever commit.author is set; rolls fail early with 'Invalid release commit author' instead of git's pattern-search fallback. Configs written by older 'sis init' inherit the default email automatically; set both keys, or clear both, to control the release identity.
</details>

## 🐛 0.8.2 (2026-07-20)

### 🪨 Update GitHub Actions to Node 24



## 📦 0.8.1 (2026-07-20)

### Dependency updates
- `@r5n/cli-core` 0.4.0 → 0.4.1
- `@r5n/hydra` 0.9.0 → 0.9.1

## ✨ 0.8.0 (2026-07-20)

### 🪨 Features

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup
- [`bed3777`](https://github.com/r5n-labs/clis/commit/bed3777) feat(sisyphus): publish manifests with resolved workspace and catalog protocols
- [`3023901`](https://github.com/r5n-labs/clis/commit/3023901) feat(sisyphus): install sis bin alias alongside sisyphus

### 🪨 Bug fixes

- [`6b18017`](https://github.com/r5n-labs/clis/commit/6b18017) fix(sisyphus): preserve package.json formatting when bumping versions
- [`c164b2f`](https://github.com/r5n-labs/clis/commit/c164b2f) fix(sisyphus): reject publishing manifests that depend on private workspace packages
- [`c4ebacc`](https://github.com/r5n-labs/clis/commit/c4ebacc) fix(sisyphus): make release committer match the configured author

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`9079453`](https://github.com/r5n-labs/clis/commit/9079453) chore: restore manifest formatting and sync lockfile after release
- [`28d36e3`](https://github.com/r5n-labs/clis/commit/28d36e3) chore: rebrand release identity to r5n-bot and add sisyphus logo
- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

## ✨ 0.7.0 (2026-07-20)

### 🪨 Features

- [`bed3777`](https://github.com/r5n-labs/clis/commit/bed3777) feat(sisyphus): publish manifests with resolved workspace and catalog protocols
- [`3023901`](https://github.com/r5n-labs/clis/commit/3023901) feat(sisyphus): install sis bin alias alongside sisyphus

### 🪨 Bug fixes

- [`c164b2f`](https://github.com/r5n-labs/clis/commit/c164b2f) fix(sisyphus): reject publishing manifests that depend on private workspace packages
- [`c4ebacc`](https://github.com/r5n-labs/clis/commit/c4ebacc) fix(sisyphus): make release committer match the configured author

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`28d36e3`](https://github.com/r5n-labs/clis/commit/28d36e3) chore: rebrand release identity to r5n-bot and add sisyphus logo
- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

### 🪨 Features

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup

## ✨ 0.6.0 (2026-07-19)

### 🪨 Features

- [`bed3777`](https://github.com/r5n-labs/clis/commit/bed3777) feat(sisyphus): publish manifests with resolved workspace and catalog protocols
- [`3023901`](https://github.com/r5n-labs/clis/commit/3023901) feat(sisyphus): install sis bin alias alongside sisyphus

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

## 🐛 0.5.1 (2026-07-19)

### 🪨 Bug fixes

- [`1e05c63`](https://github.com/r5n-labs/clis/commit/1e05c63) fix(tools): resolve workspace and catalog protocols on publish with manifest restore
- [`5cc709f`](https://github.com/r5n-labs/clis/commit/5cc709f) fix(sisyphus): use spinner error styling on failure paths

### 🪨 Tests

- [`4454834`](https://github.com/r5n-labs/clis/commit/4454834) test(core,sisyphus): add unit tests for pure functions (#11)

### 🪨 Chores

- [`5ffd491`](https://github.com/r5n-labs/clis/commit/5ffd491) chore: bumps
- [`96ead19`](https://github.com/r5n-labs/clis/commit/96ead19) chore(deps): bump the dependencies group with 5 updates (#19)
  <details>
  <summary>Details</summary>

  Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
  </details>
- [`151af94`](https://github.com/r5n-labs/clis/commit/151af94) chore(deps): bump the dependencies group with 4 updates (#3)
  <details>
  <summary>Details</summary>

  Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
  </details>

### 🪨 Other changes

- [`698f737`](https://github.com/r5n-labs/clis/commit/698f737) [r5n-86] [Hydra] `update` command (#17)
- [`32916fb`](https://github.com/r5n-labs/clis/commit/32916fb) [r5n-0] gitlab support, `actions` command improvements/fixes (#14)
- [`644bde3`](https://github.com/r5n-labs/clis/commit/644bde3) [r5n-83] `actions` command (#7)
- [`3764b4b`](https://github.com/r5n-labs/clis/commit/3764b4b) [R5N-80] Add `pr` command to create stones from pull requests (#4)
  <details>
  <summary>Details</summary>

  Co-authored-by: Ice <17621507+ice-chillios@users.noreply.github.com>
  </details>
- [`b1cd013`](https://github.com/r5n-labs/clis/commit/b1cd013) :tada

## ✨ 0.5.0 (2026-03-07)

### 🪨 Rewrite to class-based architecture with immutable domain model

<details>
<summary>Description</summary>

  Complete rewrite from function-based commands to class-based OOP with domain-driven design.
  
  Key changes:
  - Commands: standalone functions → classes extending BaseCommand with typed context
  - Domain: plain types → immutable objects (Package, Stone, Commit) with static factories and withX() transformers
  - Storage: markdown table stones → JSON files
  - Services: scattered helpers → clear service classes (WorkspaceScanner, StoneManager, ChangelogGenerator, etc.)
</details>

### Dependency updates
- `@r5n/cli-core` 0.1.0 → 0.2.0
