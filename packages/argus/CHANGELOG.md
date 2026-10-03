# @r5n/argus

## ✨ 0.3.0 (2026-10-03)

### 🪨 Features

- [`6559a38`](https://github.com/r5n-labs/clis/commit/6559a38) feat(argus): support Cloudflare models and refresh CLI guides (#44)
  <details>
  <summary>Details</summary>

  Allow Argus to use Cloudflare Clef and Clef Flash through a shared evaluator, with provider-aware limits, canonical model identities and saved-response recovery.
  
  Make the CLI entry points easier to read with concise READMEs, linked reference guides and recognisable mythological logos for Sisyphus, Hydra, Atlas and Argus.
  
  Install the repository-local test-audit skill, repair recovery coverage to exercise real interrupted runs and remove a duplicate validation case.
  </details>

## ✨ 0.2.0 (2026-10-03)

### 🪨 Features

- [`991f08b`](https://github.com/r5n-labs/clis/commit/991f08b) feat(argus): add incremental reviews and harden CLI workflows (#43)
  <details>
  <summary>Details</summary>

  Add the private Argus CLI for incremental reviews of TypeScript, TSX,
  GDScript, Godot resources and gettext. Persist source evidence, evaluations,
  review snapshots and verdicts so cached results remain tied to the code
  under review. Bundle the parsers and portable HTML report in one executable.
  
  Preserve configuration and runner data across the shared CLIs. Harden
  Sisyphus commit analysis, previews, provider file discovery, publication
  manifests and ledger archival to prevent incomplete release plans and
  loss of existing state.
  
  Share npm output parsing and JSON update logic, and replace private-helper
  test seams with checks at command, child-process and publication boundaries.
  
  Validation: 1,698 tests pass with one conditional skip; all six CI checks,
  workspace type checks, lint, builds and copied-executable smoke checks pass.
  </details>

### Dependency updates
- `@r5n/cli-core` 0.4.4 → 0.5.0
- `@r5n/sisyphus` 0.10.0 → 0.11.0
