# @r5n/argus

## 🐛 0.3.4 (2026-10-05)

### 🪨 Tests

- [`a640f68`](https://github.com/r5n-labs/clis/commit/a640f68) test(argus): keep gettext cases with the gettext parser tests
  <details>
  <summary>Details</summary>

  Move the gettext context, plural and source location cases out of the GDScript
  tests and drop a row that duplicated the trailing garbage case.
  </details>
- [`f68e926`](https://github.com/r5n-labs/clis/commit/f68e926) test(argus): remove duplicated and circular review tests
  <details>
  <summary>Details</summary>

  Drop an HTML report test whose contracts belong to stronger viewer, render and
  snapshot tests, remove a fingerprint assertion computed by the helper under
  test, fold the comment preset upgrade into the config upgrade table with the
  missing naming row, and keep only the translation row that proves decoding.
  </details>

### Dependency updates
- `@r5n/sisyphus` 0.13.0 → 0.13.1
- `@r5n/atlas` 0.6.3 → 0.6.4
- `@r5n/hydra` 0.11.2 → 0.11.3
- `@r5n/tools` 0.3.0 → 0.3.1

## 🐛 0.3.3 (2026-10-04)

### 🪨 Publish the redesigned logos

<details>
<summary>Description</summary>

  The previous patch was tagged in git but never reached npm because trusted publishing was not yet configured for Argus and Atlas.
</details>

## 🐛 0.3.2 (2026-10-04)

### 🪨 Documentation

- [`cee4b11`](https://github.com/r5n-labs/clis/commit/cee4b11) docs: redesign CLI logos as geometric marks
  <details>
  <summary>Details</summary>

  Replace the uneven silhouettes with one family of bold, minimal marks that
  share a palette and a single terracotta accent, so every logo stays legible
  at README and favicon sizes. Drop the unused Sisyphus PNG because only the
  SVG logos are referenced.
  </details>

## 🐛 0.3.1 (2026-10-03)

### 🪨 Chores

- [`7f3d092`](https://github.com/r5n-labs/clis/commit/7f3d092) chore: enable public Argus and Atlas releases (#45)
  <details>
  <summary>Details</summary>

  Remove the private flags from Argus and Atlas so Sisyphus can publish both bundled CLIs. Declare Argus's public registry and repository metadata, and include the complete repository licence in Atlas's archive.
  
  Document global installation and installed commands, with npm-compatible guide links and separate source development instructions.
  </details>

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
