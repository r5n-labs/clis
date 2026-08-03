# @r5n/cli-core

## 🐛 0.4.3 (2026-08-03)

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

## 🐛 0.4.2 (2026-07-28)

### 🪨 feat: harden profile and release workflows

<details>
<summary>Description</summary>

  Release commits now require a valid commit.email whenever commit.author is set; rolls fail early with 'Invalid release commit author' instead of git's pattern-search fallback. Configs written by older 'sis init' inherit the default email automatically; set both keys, or clear both, to control the release identity.
</details>

## 🐛 0.4.1 (2026-07-20)

### 🪨 Improve CLI help and cleanup safety



## ✨ 0.4.0 (2026-07-20)

### 🪨 Features

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`9079453`](https://github.com/r5n-labs/clis/commit/9079453) chore: restore manifest formatting and sync lockfile after release
- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

### Dependency updates
- `@r5n/sisyphus` 0.7.0 → 0.8.0
- `@r5n/tools` 0.1.0 → 0.2.0
- `@r5n/hydra` 0.8.0 → 0.9.0

## ✨ 0.3.0 (2026-07-20)

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

### 🪨 Features

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup

### Dependency updates
- `@r5n/tools` 0.0.2 → 0.1.0
- `@r5n/sisyphus` 0.6.0 → 0.7.0
- `@r5n/hydra` 0.7.0 → 0.8.0

## 🐛 0.2.2 (2026-07-19)

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

## 🐛 0.2.1 (2026-07-19)

### 🪨 Bug fixes

- [`0edd9d6`](https://github.com/r5n-labs/clis/commit/0edd9d6) fix(core): support help command and drop duplicate clack instruction hints

### 🪨 Tests

- [`4454834`](https://github.com/r5n-labs/clis/commit/4454834) test(core,sisyphus): add unit tests for pure functions (#11)

### 🪨 Chores

- [`ca3072d`](https://github.com/r5n-labs/clis/commit/ca3072d) chore: format package manifests with biome
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

- [`b06781a`](https://github.com/r5n-labs/clis/commit/b06781a) [r5n-64] `hydra` cli (#16)
- [`32916fb`](https://github.com/r5n-labs/clis/commit/32916fb) [r5n-0] gitlab support, `actions` command improvements/fixes (#14)
- [`644bde3`](https://github.com/r5n-labs/clis/commit/644bde3) [r5n-83] `actions` command (#7)
- [`3764b4b`](https://github.com/r5n-labs/clis/commit/3764b4b) [R5N-80] Add `pr` command to create stones from pull requests (#4)
  <details>
  <summary>Details</summary>

  Co-authored-by: Ice <17621507+ice-chillios@users.noreply.github.com>
  </details>
- [`b1cd013`](https://github.com/r5n-labs/clis/commit/b1cd013) :tada

## ✨ 0.2.0 (2026-03-07)

### 🪨 Rewrite from utility library to class-based CLI framework

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
