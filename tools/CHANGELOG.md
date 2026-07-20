# @r5n/tools

## ✨ 0.1.0 (2026-07-20)

### 🪨 Bug fixes

- [`faf57dd`](https://github.com/r5n-labs/clis/commit/faf57dd) fix(tools): reject publishing manifests that depend on private workspace packages

### 🪨 Chores

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

### 🪨 Features

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup

## 🐛 0.0.2 (2026-07-19)

### 🪨 Chores

- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

## 🐛 0.0.1 (2026-07-19)

### 🪨 Bug fixes

- [`1e05c63`](https://github.com/r5n-labs/clis/commit/1e05c63) fix(tools): resolve workspace and catalog protocols on publish with manifest restore
- [`fd66bc2`](https://github.com/r5n-labs/clis/commit/fd66bc2) fix(tsconfig): remove deprecated downlevelIteration to unblock CI
  <details>
  <summary>Details</summary>

  Option is deprecated as of TS 5.5+ and TS5101 fails the build with a
  non-zero exit. Target is ESNext so the flag has no runtime effect anyway.
  
  Also picks up a Biome auto-format on package.json (workspaces field).
  </details>

### 🪨 Tests

- [`4454834`](https://github.com/r5n-labs/clis/commit/4454834) test(core,sisyphus): add unit tests for pure functions (#11)

### 🪨 Chores

- [`5d3f8bc`](https://github.com/r5n-labs/clis/commit/5d3f8bc) chore: update workflows

### 🪨 Other changes

- [`698f737`](https://github.com/r5n-labs/clis/commit/698f737) [r5n-86] [Hydra] `update` command (#17)
- [`b1cd013`](https://github.com/r5n-labs/clis/commit/b1cd013) :tada
