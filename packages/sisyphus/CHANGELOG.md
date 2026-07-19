# @r5n/sisyphus

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
