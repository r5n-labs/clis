# Changelog

## 2026-07-20 - @r5n/sisyphus@0.8.2

**Packages**
- 🐛 `@r5n/sisyphus` 0.8.1 → 0.8.2

### 🪨 Update GitHub Actions to Node 24
**Packages:** `@r5n/sisyphus`



## 2026-07-20 - @r5n/cli-core@0.4.1, @r5n/hydra@0.9.1, @r5n/sisyphus@0.8.1

**Packages**
- 🐛 `@r5n/cli-core` 0.4.0 → 0.4.1
- 🐛 `@r5n/hydra` 0.9.0 → 0.9.1
- 📦 `@r5n/sisyphus` 0.8.0 → 0.8.1

### 🪨 Improve CLI help and cleanup safety
**Packages:** `@r5n/cli-core` · `@r5n/hydra`



## 2026-07-20 - @r5n/atlas@0.3.0, @r5n/cli-core@0.4.0, @r5n/hydra@0.9.0, @r5n/sisyphus@0.8.0, @r5n/tools@0.2.0

**Packages**
- ✨ `@r5n/atlas` 0.2.0 → 0.3.0
- ✨ `@r5n/cli-core` 0.3.0 → 0.4.0
- ✨ `@r5n/hydra` 0.8.0 → 0.9.0
- ✨ `@r5n/sisyphus` 0.7.0 → 0.8.0
- ✨ `@r5n/tools` 0.1.0 → 0.2.0

### 🪨 Features
**Packages:** `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/sisyphus` · `@r5n/tools`

<details>
<summary>Commits (4)</summary>

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup
- [`bed3777`](https://github.com/r5n-labs/clis/commit/bed3777) feat(sisyphus): publish manifests with resolved workspace and catalog protocols
- [`9feb9f3`](https://github.com/r5n-labs/clis/commit/9feb9f3) feat(hydra): support organization-level runners
- [`3023901`](https://github.com/r5n-labs/clis/commit/3023901) feat(sisyphus): install sis bin alias alongside sisyphus

</details>

### 🪨 Bug fixes
**Packages:** `@r5n/sisyphus` · `@r5n/tools` · `@r5n/hydra`

<details>
<summary>Commits (5)</summary>

- [`6b18017`](https://github.com/r5n-labs/clis/commit/6b18017) fix(sisyphus): preserve package.json formatting when bumping versions
- [`faf57dd`](https://github.com/r5n-labs/clis/commit/faf57dd) fix(tools): reject publishing manifests that depend on private workspace packages
- [`c164b2f`](https://github.com/r5n-labs/clis/commit/c164b2f) fix(sisyphus): reject publishing manifests that depend on private workspace packages
- [`1d37241`](https://github.com/r5n-labs/clis/commit/1d37241) fix(hydra): drop runtime dependency on private cli-core (published manifest was uninstallable)
- [`c4ebacc`](https://github.com/r5n-labs/clis/commit/c4ebacc) fix(sisyphus): make release committer match the configured author

</details>

### 🪨 Documentation
**Packages:** `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/sisyphus`

<details>
<summary>Commits (1)</summary>

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

</details>

### 🪨 Chores
**Packages:** `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/sisyphus` · `@r5n/tools`

<details>
<summary>Commits (3)</summary>

- [`9079453`](https://github.com/r5n-labs/clis/commit/9079453) chore: restore manifest formatting and sync lockfile after release
- [`28d36e3`](https://github.com/r5n-labs/clis/commit/28d36e3) chore: rebrand release identity to r5n-bot and add sisyphus logo
- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

</details>

## 2026-07-20 - @r5n/sisyphus@0.7.0, @r5n/hydra@0.8.0, @r5n/tools@0.1.0, @r5n/atlas@0.2.0, @r5n/cli-core@0.3.0

**Packages**
- ✨ `@r5n/sisyphus` 0.6.0 → 0.7.0
- ✨ `@r5n/hydra` 0.7.0 → 0.8.0
- ✨ `@r5n/tools` 0.0.2 → 0.1.0
- ✨ `@r5n/atlas` 0.1.2 → 0.2.0
- ✨ `@r5n/cli-core` 0.2.2 → 0.3.0

### 🪨 Features
**Packages:** `@r5n/sisyphus` · `@r5n/hydra`

<details>
<summary>Commits (3)</summary>

- [`bed3777`](https://github.com/r5n-labs/clis/commit/bed3777) feat(sisyphus): publish manifests with resolved workspace and catalog protocols
- [`9feb9f3`](https://github.com/r5n-labs/clis/commit/9feb9f3) feat(hydra): support organization-level runners
- [`3023901`](https://github.com/r5n-labs/clis/commit/3023901) feat(sisyphus): install sis bin alias alongside sisyphus

</details>

### 🪨 Bug fixes
**Packages:** `@r5n/tools` · `@r5n/sisyphus` · `@r5n/hydra`

<details>
<summary>Commits (4)</summary>

- [`faf57dd`](https://github.com/r5n-labs/clis/commit/faf57dd) fix(tools): reject publishing manifests that depend on private workspace packages
- [`c164b2f`](https://github.com/r5n-labs/clis/commit/c164b2f) fix(sisyphus): reject publishing manifests that depend on private workspace packages
- [`1d37241`](https://github.com/r5n-labs/clis/commit/1d37241) fix(hydra): drop runtime dependency on private cli-core (published manifest was uninstallable)
- [`c4ebacc`](https://github.com/r5n-labs/clis/commit/c4ebacc) fix(sisyphus): make release committer match the configured author

</details>

### 🪨 Documentation
**Packages:** `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/sisyphus`

<details>
<summary>Commits (1)</summary>

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

</details>

### 🪨 Chores
**Packages:** `@r5n/sisyphus` · `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/tools`

<details>
<summary>Commits (2)</summary>

- [`28d36e3`](https://github.com/r5n-labs/clis/commit/28d36e3) chore: rebrand release identity to r5n-bot and add sisyphus logo
- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

</details>

### 🪨 Features
**Packages:** `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/sisyphus` · `@r5n/tools`

<details>
<summary>Commits (1)</summary>

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup

</details>

## 2026-07-19 - @r5n/sisyphus@0.6.0, @r5n/hydra@0.7.0, @r5n/atlas@0.1.2, @r5n/cli-core@0.2.2, @r5n/tools@0.0.2

**Packages**
- ✨ `@r5n/sisyphus` 0.5.1 → 0.6.0
- ✨ `@r5n/hydra` 0.6.0 → 0.7.0
- 🐛 `@r5n/atlas` 0.1.1 → 0.1.2
- 🐛 `@r5n/cli-core` 0.2.1 → 0.2.2
- 🐛 `@r5n/tools` 0.0.1 → 0.0.2

### 🪨 Features
**Packages:** `@r5n/sisyphus` · `@r5n/hydra`

<details>
<summary>Commits (3)</summary>

- [`bed3777`](https://github.com/r5n-labs/clis/commit/bed3777) feat(sisyphus): publish manifests with resolved workspace and catalog protocols
- [`9feb9f3`](https://github.com/r5n-labs/clis/commit/9feb9f3) feat(hydra): support organization-level runners
- [`3023901`](https://github.com/r5n-labs/clis/commit/3023901) feat(sisyphus): install sis bin alias alongside sisyphus

</details>

### 🪨 Documentation
**Packages:** `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/sisyphus`

<details>
<summary>Commits (1)</summary>

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

</details>

### 🪨 Chores
**Packages:** `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/sisyphus` · `@r5n/tools`

<details>
<summary>Commits (1)</summary>

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

</details>

## 2026-07-19 - @r5n/hydra@0.6.0, @r5n/atlas@0.1.1, @r5n/sisyphus@0.5.1, @r5n/tools@0.0.1, @r5n/cli-core@0.2.1

**Packages**
- ✨ `@r5n/hydra` 0.5.8 → 0.6.0
- 🐛 `@r5n/atlas` 0.1.0 → 0.1.1
- 🐛 `@r5n/sisyphus` 0.5.0 → 0.5.1
- 🐛 `@r5n/tools` 0.0.0 → 0.0.1
- 🐛 `@r5n/cli-core` 0.2.0 → 0.2.1

### 🪨 Features
**Packages:** `@r5n/hydra`

<details>
<summary>Commits (1)</summary>

- [`8a6db08`](https://github.com/r5n-labs/clis/commit/8a6db08) feat(hydra): add logs command for inspecting runner job logs

</details>

### 🪨 Bug fixes
**Packages:** `@r5n/atlas` · `@r5n/hydra` · `@r5n/sisyphus` · `@r5n/tools` · `@r5n/cli-core`

<details>
<summary>Commits (4)</summary>

- [`1e05c63`](https://github.com/r5n-labs/clis/commit/1e05c63) fix(tools): resolve workspace and catalog protocols on publish with manifest restore
- [`5cc709f`](https://github.com/r5n-labs/clis/commit/5cc709f) fix(sisyphus): use spinner error styling on failure paths
- [`0edd9d6`](https://github.com/r5n-labs/clis/commit/0edd9d6) fix(core): support help command and drop duplicate clack instruction hints
- [`fd66bc2`](https://github.com/r5n-labs/clis/commit/fd66bc2) fix(tsconfig): remove deprecated downlevelIteration to unblock CI
  <details>
  <summary>Details</summary>

  Option is deprecated as of TS 5.5+ and TS5101 fails the build with a
  non-zero exit. Target is ESNext so the flag has no runtime effect anyway.
  
  Also picks up a Biome auto-format on package.json (workspaces field).
  </details>

</details>

### 🪨 Tests
**Packages:** `@r5n/cli-core` · `@r5n/sisyphus` · `@r5n/tools`

<details>
<summary>Commits (1)</summary>

- [`4454834`](https://github.com/r5n-labs/clis/commit/4454834) test(core,sisyphus): add unit tests for pure functions (#11)

</details>

### 🪨 Chores
**Packages:** `@r5n/cli-core` · `@r5n/atlas` · `@r5n/hydra` · `@r5n/sisyphus` · `@r5n/tools`

<details>
<summary>Commits (5)</summary>

- [`ca3072d`](https://github.com/r5n-labs/clis/commit/ca3072d) chore: format package manifests with biome
- [`5ffd491`](https://github.com/r5n-labs/clis/commit/5ffd491) chore: bumps
- [`96ead19`](https://github.com/r5n-labs/clis/commit/96ead19) chore(deps): bump the dependencies group with 5 updates (#19)
  <details>
  <summary>Details</summary>

  Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
  </details>
- [`5d3f8bc`](https://github.com/r5n-labs/clis/commit/5d3f8bc) chore: update workflows
- [`151af94`](https://github.com/r5n-labs/clis/commit/151af94) chore(deps): bump the dependencies group with 4 updates (#3)
  <details>
  <summary>Details</summary>

  Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
  </details>

</details>

### 🪨 Other changes
**Packages:** `@r5n/hydra` · `@r5n/sisyphus` · `@r5n/tools` · `@r5n/cli-core` · `@r5n/atlas`

<details>
<summary>Commits (6)</summary>

- [`698f737`](https://github.com/r5n-labs/clis/commit/698f737) [r5n-86] [Hydra] `update` command (#17)
- [`b06781a`](https://github.com/r5n-labs/clis/commit/b06781a) [r5n-64] `hydra` cli (#16)
- [`32916fb`](https://github.com/r5n-labs/clis/commit/32916fb) [r5n-0] gitlab support, `actions` command improvements/fixes (#14)
- [`644bde3`](https://github.com/r5n-labs/clis/commit/644bde3) [r5n-83] `actions` command (#7)
- [`3764b4b`](https://github.com/r5n-labs/clis/commit/3764b4b) [R5N-80] Add `pr` command to create stones from pull requests (#4)
  <details>
  <summary>Details</summary>

  Co-authored-by: Ice <17621507+ice-chillios@users.noreply.github.com>
  </details>
- [`b1cd013`](https://github.com/r5n-labs/clis/commit/b1cd013) :tada

</details>

## 2026-03-07

**Packages**
- ✨ `@r5n/cli-core` 0.1.0 → 0.2.0
- ✨ `@r5n/sisyphus` 0.4.8 → 0.5.0

### 🪨 Rewrite from utility library to class-based CLI framework
**Packages:** `@r5n/cli-core`

<details>
<summary>Description</summary>

  Transformed from a utility library (colors, git helpers, error handling, fuzzy matching) into a full CLI framework.
  
  New abstractions:
  - AbstractCLI: command routing, dual-mode (direct + interactive), global args, error boundaries
  - AbstractCommand: typed args/positionals with inference, subcommand composition, lifecycle hooks
  - ConfigManager: typed JSON persistence with deep merge
  - Exit/Cancel error classes with built-in handling
  
  CLIs now extend the framework instead of wiring up their own dispatch.
</details>

### 🪨 Rewrite to class-based architecture with immutable domain model
**Packages:** `@r5n/sisyphus`

<details>
<summary>Description</summary>

  Complete rewrite from function-based commands to class-based OOP with domain-driven design.
  
  Key changes:
  - Commands: standalone functions → classes extending BaseCommand with typed context
  - Domain: plain types → immutable objects (Package, Stone, Commit) with static factories and withX() transformers
  - Storage: markdown table stones → JSON files
  - Services: scattered helpers → clear service classes (WorkspaceScanner, StoneManager, ChangelogGenerator, etc.)
</details>
