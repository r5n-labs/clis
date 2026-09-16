# @r5n/tools

## 🐛 0.2.2 (2026-09-16)

### 🪨 Bug fixes

- [`eafb119`](https://github.com/r5n-labs/clis/commit/eafb119) fix(sisyphus): preserve release plans and reconcile interrupted publication
  <details>
  <summary>Details</summary>

  Keep prerelease graduation and dependency ordering consistent across previews, release PRs and archived plans. Reject invalid stones, tags, commit baselines and foreign PR URLs before they can produce incomplete releases. Recover interrupted pushes without overwriting divergent refs, validate immutable publication settings before external actions, and preserve local work during CI release preparation.
  </details>
- [`cb068b9`](https://github.com/r5n-labs/clis/commit/cb068b9) fix(tools): preserve setup state and immutable publication settings
  <details>
  <summary>Details</summary>

  Keep frozen lockfiles during retries, install setup dependencies before hooks run, and preserve existing workspace catalogues and scripts. Honour access and prerelease channels from packed manifests, keep dry runs offline, and make builder and packing failures deterministic and recoverable. Resume saved releases even after their pending stones have been archived.
  </details>
- [`2f45243`](https://github.com/r5n-labs/clis/commit/2f45243) fix(sisyphus): read the npm 12 pack and view document shapes
  <details>
  <summary>Details</summary>

  npm 12 changed `npm pack --json` from an array to an object keyed by
  package name, and `npm view <name@version> --json` from a single object
  to a one-element array. Both parsers assumed the npm 11 shape, so every
  pack guard and the started-publish reconciliation failed outright on a
  machine with npm 12, and the packed 16 MB zero-filled fixture tripped
  npm 12's tar decompression-ratio guard.
  
  Normalise both documents through a shared parser that accepts either
  shape, unwrap a single-element view result, and fill the pack-delay
  fixture with random bytes so it still packs slowly without looking like
  a decompression bomb. The tools script gets the same parser because it
  runs standalone outside the sisyphus bundle.
  </details>

### 🪨 Chores

- [`30c5ce6`](https://github.com/r5n-labs/clis/commit/30c5ce6) chore: make the pre-commit hook lint again and migrate the biome preset
  <details>
  <summary>Details</summary>

  The hook's run template referenced {files} without a files command, so
  lefthook resolved an empty list and skipped linting on every commit
  ("no files for inspection"). stage_fixed already re-stages what Biome
  rewrites, so the trailing git add was redundant as well as fatal.
  
  Biome 2.5 renamed the recommended switch to a preset; apply the migration
  it reports on every check.
  </details>

### 🪨 Tests

- [`e9b35d1`](https://github.com/r5n-labs/clis/commit/e9b35d1) test(tools): restore PATH when delegating npm calls
  <details>
  <summary>Details</summary>

  A package-manager dispatcher can resolve npm by name after removing its own shim directory. Keeping the test interception directory on that path re-enters the interceptor and can hang indefinitely. Delegate with the original PATH and include captured subprocess output in failure diagnostics.
  </details>

### 🪨 CI

- [`1a827f2`](https://github.com/r5n-labs/clis/commit/1a827f2) ci: isolate Bun installations for concurrent runners
  <details>
  <summary>Details</summary>

  Self-hosted jobs share a home directory, so restoring Bun into the default path can overwrite an executable another job is starting. Install the selected version beneath each job's temporary directory and reuse the workspace setup action for frozen dependency installation.
  </details>

## 🐛 0.2.1 (2026-08-03)

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

## ✨ 0.2.0 (2026-07-20)

### 🪨 Features

- [`d3788f3`](https://github.com/r5n-labs/clis/commit/d3788f3) feat(hydra): cleanup command with config-driven auto cleanup

### 🪨 Bug fixes

- [`faf57dd`](https://github.com/r5n-labs/clis/commit/faf57dd) fix(tools): reject publishing manifests that depend on private workspace packages

### 🪨 Chores

- [`9079453`](https://github.com/r5n-labs/clis/commit/9079453) chore: restore manifest formatting and sync lockfile after release
- [`b4eefb3`](https://github.com/r5n-labs/clis/commit/b4eefb3) chore(sisyphus): push releases from CI and record rolled stones

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
