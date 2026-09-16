# @r5n/hydra

## 🐛 0.9.4 (2026-09-16)

### 🪨 Bug fixes

- [`a34aee1`](https://github.com/r5n-labs/clis/commit/a34aee1) fix(hydra): preserve runner state across lifecycle failures
  <details>
  <summary>Details</summary>

  Track completed registrations and removals as they happen so partial failures remain recoverable. Publish only complete downloads, stop the selected detached process group, update each stale runner and reject unknown options before mutation. Keep runner binaries under explicit Hydra update control.
  </details>
- [`5092729`](https://github.com/r5n-labs/clis/commit/5092729) fix(sisyphus): close the gauntlet findings across planning, previews and reporting
  <details>
  <summary>Details</summary>

  Graduation is now decided per package, not per stone. applyStone seeds
  the graduating set from explicitly bumped packages that are leaving a
  prerelease and closes it transitively over workspace dependencies, so
  merging an unrelated graduating stone can no longer promote an
  independent mid-prerelease dependent to a stable version. An untagged
  dependency bump on a non-canonical prerelease now fails closed instead
  of silently graduating.
  
  breakCycle trims the stuck subgraph to genuine cycle members before
  choosing what to force, so an acyclic package behind a cycle is no
  longer published before its own dependency or reported as cyclic.
  
  roll strips config.ignore before merging stones, so an ignored-only
  stone can neither trigger the tag-homogeneity error nor brick release CI;
  an empty release distinguishes ignored-only (graceful skip) from stale
  stones referencing unknown packages (hard error naming them). The same
  distinction now guards release-pr via shared release-plan helpers, and
  its PR title is capped instead of unbounded.
  
  check and the version previews predict versions through applyStone, so
  what the user is shown matches what roll will produce, and one invalid
  manifest degrades a single row instead of killing the command. pr now
  rejects explicitly requested ignored packages, and migrate validates
  every changeset before writing any stone.
  
  roll --json no longer treats the flag as consent: an interactive
  terminal without --yes fails closed. The report gains a required
  warnings array carrying ignore exclusions, cycle caveats and channel
  problems; per-package git tags are gated on tagsReady like the tag list;
  the stdout guard also intercepts console.log; and a mixed-channel plan
  degrades a dry run to a warning instead of losing the failure report.
  
  Build outputs declared as bare directories now match their contents, a
  missing build executable carries its context label, schema.json accepts
  hidden-directory outputs it previously rejected, hydra's tests are back
  under type-check, and the resume path's root-build skip/re-run behaviour
  is pinned by tests.
  </details>

### Dependency updates
- `@r5n/tools` 0.2.1 → 0.2.2

## 📦 0.9.3 (2026-08-03)

### Dependency updates
- `@r5n/atlas` 0.4.0 → 0.4.1
- `@r5n/cli-core` 0.4.2 → 0.4.3
- `@r5n/sisyphus` 0.9.0 → 0.9.1
- `@r5n/tools` 0.2.0 → 0.2.1

## 🐛 0.9.2 (2026-07-28)

### 🪨 feat: harden profile and release workflows

<details>
<summary>Description</summary>

  Release commits now require a valid commit.email whenever commit.author is set; rolls fail early with 'Invalid release commit author' instead of git's pattern-search fallback. Configs written by older 'sis init' inherit the default email automatically; set both keys, or clear both, to control the release identity.
</details>

## 🐛 0.9.1 (2026-07-20)

### 🪨 Improve CLI help and cleanup safety



## ✨ 0.9.0 (2026-07-20)

### 🪨 Features

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup
- [`9feb9f3`](https://github.com/r5n-labs/clis/commit/9feb9f3) feat(hydra): support organization-level runners

### 🪨 Bug fixes

- [`1d37241`](https://github.com/r5n-labs/clis/commit/1d37241) fix(hydra): drop runtime dependency on private cli-core (published manifest was uninstallable)

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`9079453`](https://github.com/r5n-labs/clis/commit/9079453) chore: restore manifest formatting and sync lockfile after release
- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

## ✨ 0.8.0 (2026-07-20)

### 🪨 Features

- [`9feb9f3`](https://github.com/r5n-labs/clis/commit/9feb9f3) feat(hydra): support organization-level runners

### 🪨 Bug fixes

- [`1d37241`](https://github.com/r5n-labs/clis/commit/1d37241) fix(hydra): drop runtime dependency on private cli-core (published manifest was uninstallable)

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

### 🪨 Features

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup

## ✨ 0.7.0 (2026-07-19)

### 🪨 Features

- [`9feb9f3`](https://github.com/r5n-labs/clis/commit/9feb9f3) feat(hydra): support organization-level runners

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

## ✨ 0.6.0 (2026-07-19)

### 🪨 Features

- [`8a6db08`](https://github.com/r5n-labs/clis/commit/8a6db08) feat(hydra): add logs command for inspecting runner job logs

### 🪨 Bug fixes

- [`1e05c63`](https://github.com/r5n-labs/clis/commit/1e05c63) fix(tools): resolve workspace and catalog protocols on publish with manifest restore

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
- [`b06781a`](https://github.com/r5n-labs/clis/commit/b06781a) [r5n-64] `hydra` cli (#16)
- [`b1cd013`](https://github.com/r5n-labs/clis/commit/b1cd013) :tada

### Dependency updates
- `@r5n/cli-core` 0.2.0 → 0.2.1
- `@r5n/sisyphus` 0.5.0 → 0.5.1
- `@r5n/tools` 0.0.0 → 0.0.1
