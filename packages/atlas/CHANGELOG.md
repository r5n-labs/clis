# @r5n/atlas

## ✨ 0.4.0 (2026-07-28)

### 🪨 feat: harden profile and release workflows

<details>
<summary>Description</summary>

  Release commits now require a valid commit.email whenever commit.author is set; rolls fail early with 'Invalid release commit author' instead of git's pattern-search fallback. Configs written by older 'sis init' inherit the default email automatically; set both keys, or clear both, to control the release identity.
</details>

## ✨ 0.3.0 (2026-07-20)

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

## ✨ 0.2.0 (2026-07-20)

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

## 🐛 0.1.2 (2026-07-19)

### 🪨 Documentation

- [`9a558c0`](https://github.com/r5n-labs/clis/commit/9a558c0) docs: rewrite READMEs from actual code and refresh agent guidelines

### 🪨 Chores

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

## 🐛 0.1.1 (2026-07-19)

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

- [`b1cd013`](https://github.com/r5n-labs/clis/commit/b1cd013) :tada

### Dependency updates
- `@r5n/cli-core` 0.2.0 → 0.2.1
- `@r5n/sisyphus` 0.5.0 → 0.5.1
- `@r5n/tools` 0.0.0 → 0.0.1
