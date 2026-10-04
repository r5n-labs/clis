# @r5n/atlas

## 🐛 0.6.3 (2026-10-04)

### 🪨 Publish the redesigned logos

<details>
<summary>Description</summary>

  The previous patch was tagged in git but never reached npm because trusted publishing was not yet configured for Argus and Atlas.
</details>

## 🐛 0.6.2 (2026-10-04)

### 🪨 Documentation

- [`cee4b11`](https://github.com/r5n-labs/clis/commit/cee4b11) docs: redesign CLI logos as geometric marks
  <details>
  <summary>Details</summary>

  Replace the uneven silhouettes with one family of bold, minimal marks that
  share a palette and a single terracotta accent, so every logo stays legible
  at README and favicon sizes. Drop the unused Sisyphus PNG because only the
  SVG logos are referenced.
  </details>

## 🐛 0.6.1 (2026-10-03)

### 🪨 Chores

- [`7f3d092`](https://github.com/r5n-labs/clis/commit/7f3d092) chore: enable public Argus and Atlas releases (#45)
  <details>
  <summary>Details</summary>

  Remove the private flags from Argus and Atlas so Sisyphus can publish both bundled CLIs. Declare Argus's public registry and repository metadata, and include the complete repository licence in Atlas's archive.
  
  Document global installation and installed commands, with npm-compatible guide links and separate source development instructions.
  </details>

## ✨ 0.6.0 (2026-10-03)

### 🪨 Features

- [`6559a38`](https://github.com/r5n-labs/clis/commit/6559a38) feat(argus): support Cloudflare models and refresh CLI guides (#44)
  <details>
  <summary>Details</summary>

  Allow Argus to use Cloudflare Clef and Clef Flash through a shared evaluator, with provider-aware limits, canonical model identities and saved-response recovery.
  
  Make the CLI entry points easier to read with concise READMEs, linked reference guides and recognisable mythological logos for Sisyphus, Hydra, Atlas and Argus.
  
  Install the repository-local test-audit skill, repair recovery coverage to exercise real interrupted runs and remove a duplicate validation case.
  </details>

## ✨ 0.5.0 (2026-10-03)

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

## 🐛 0.4.2 (2026-09-16)

### 🪨 Bug fixes

- [`d0892b1`](https://github.com/r5n-labs/clis/commit/d0892b1) fix(atlas): validate command inputs and write private files atomically
  <details>
  <summary>Details</summary>

  Reject misspelled options and malformed profile references before selecting defaults or writing files. Preserve existing files on failed writes, report configuration errors consistently in JSON mode, and distinguish missing commands from invalid working directories.
  </details>

### Dependency updates
- `@r5n/tools` 0.2.1 → 0.2.2

## 🐛 0.4.1 (2026-08-03)

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
