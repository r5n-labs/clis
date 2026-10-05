# Changelog

## 2026-10-05 - @r5n/argus@0.3.4, @r5n/atlas@0.6.4, @r5n/cli-core@0.5.1, @r5n/hydra@0.11.3, @r5n/sisyphus@0.13.1, @r5n/tools@0.3.1

**Packages**
- 🐛 `@r5n/argus` 0.3.3 → 0.3.4
- 🐛 `@r5n/atlas` 0.6.3 → 0.6.4
- 🐛 `@r5n/cli-core` 0.5.0 → 0.5.1
- 🐛 `@r5n/hydra` 0.11.2 → 0.11.3
- 🐛 `@r5n/sisyphus` 0.13.0 → 0.13.1
- 🐛 `@r5n/tools` 0.3.0 → 0.3.1

### 🪨 Bug fixes
**Packages:** `@r5n/sisyphus` · `@r5n/atlas`

<details>
<summary>Commits (4)</summary>

- [`618898c`](https://github.com/r5n-labs/clis/commit/618898c) fix(sisyphus): republish a started npm upload the registry does not list
  <details>
  <summary>Details</summary>

  Resume stopped whenever an interrupted npm publication was not on the
  registry, so a release that npm rejected, for example before trusted
  publishing was configured, could only be finished by hand or replaced with a
  new version. When the registry answers E404, re-check the durable tarball
  against the ledger integrity and publish it again through the normal publish
  path; npm never replaces a published version, so this cannot create a second
  artefact. An upload npm already accepted but does not list yet, or a registry
  that cannot be read, still stops the resume with a specific message.
  </details>
- [`1ebb6e9`](https://github.com/r5n-labs/clis/commit/1ebb6e9) fix(atlas): resolve the home directory when it is used
  <details>
  <summary>Details</summary>

  Bun caches os.homedir() at startup, so Atlas ignored a HOME changed later in
  the process and its in-process tests read the developer's real global config.
  Resolve HOME at call time like Node's homedir, and give every Atlas command
  test, in process or spawned, its own temporary home.
  </details>
- [`b197af7`](https://github.com/r5n-labs/clis/commit/b197af7) fix(sisyphus): keep the release ledger across workflow re-runs
  <details>
  <summary>Details</summary>

  Shipped release workflows lost the ledger whenever a re-run landed on a fresh
  runner, so recovery could never resume. Restore the ledger from a cache keyed
  by the workflow run and save it whenever a release left state behind, reset
  stale runner state first, and use a per-commit GitLab cache with a clone
  strategy.
  </details>
- [`48f3dd2`](https://github.com/r5n-labs/clis/commit/48f3dd2) fix(sisyphus): resume releases from a fresh checkout of the base commit
  <details>
  <summary>Details</summary>

  A re-run of a failed release job checks out the base commit on a new runner,
  but resume required HEAD to be the release commit and stopped. When HEAD is
  exactly the recorded base, the release commit exists locally, tracked files
  are clean and the commit passes the existing tree validation, check it out
  before validating so the release can continue.
  </details>

</details>

### 🪨 Refactoring
**Packages:** `@r5n/sisyphus` · `@r5n/atlas` · `@r5n/hydra` · `@r5n/tools`

<details>
<summary>Commits (9)</summary>

- [`97b3fb2`](https://github.com/r5n-labs/clis/commit/97b3fb2) refactor(sisyphus): stop exporting module-internal release helpers
  <details>
  <summary>Details</summary>

  These helpers are only used inside their own modules.
  </details>
- [`9c9c22a`](https://github.com/r5n-labs/clis/commit/9c9c22a) refactor(atlas): validate options with the core helper
  <details>
  <summary>Details</summary>

  Atlas reimplemented validateKnownArgs from @r5n/cli-core. Use the shared helper
  so unknown options are reported the same way as in the other CLIs.
  </details>
- [`a686948`](https://github.com/r5n-labs/clis/commit/a686948) refactor(hydra): drop unused provider barrel re-exports
  <details>
  <summary>Details</summary>

  Remove barrel entries that nothing imports through the barrel and stop
  exporting two constants used only inside cleanup.
  </details>
- [`3d3620d`](https://github.com/r5n-labs/clis/commit/3d3620d) refactor(sisyphus): drop the ledger id seam and test provider releases via resume
  <details>
  <summary>Details</summary>

  Release ledgers accepted a caller-supplied id that only tests used. Derive the
  id from the ledger content alone and make the race tests differ by real input.
  Exercise the provider release through ReleaseOrchestrator.resume with gh and
  ssh shims instead of injecting private orchestrator fields.
  </details>
- [`2ee0768`](https://github.com/r5n-labs/clis/commit/2ee0768) refactor(tools,sisyphus): share one publish manifest implementation
  <details>
  <summary>Details</summary>

  Sisyphus and the tools publish scripts kept identical copies of the workspace
  and catalogue resolution, which had started to drift. Keep one implementation
  in tools that raises a typed PublishManifestError with a hint, let Sisyphus
  convert it to Exit at its boundary, and test every contract once through the
  public entry points. prepare-publish now prints the hint for each failure and
  preserves the manifest indentation.
  </details>
- [`6c9b399`](https://github.com/r5n-labs/clis/commit/6c9b399) refactor(atlas): test config discovery and blank options at the boundary
  <details>
  <summary>Details</summary>

  Test discovery through loadAtlasConfig so discoverAtlasConfig no longer needs
  an export, delete a test that only exercised a local helper, and move the
  blank --cwd and --profile CLI cases into the validation table with their
  messages, since the old exit-code check passed for an unrelated reason.
  </details>
- [`952d555`](https://github.com/r5n-labs/clis/commit/952d555) refactor(hydra): test log cleanup through its boundaries
  <details>
  <summary>Details</summary>

  Remove exports and barrel entries that only tests used, cover log
  classification through discoverLogFiles, and replace the cutoff formula test
  with a performCleanup case proving that olderThanDays counts whole days.
  </details>
- [`d8b622e`](https://github.com/r5n-labs/clis/commit/d8b622e) refactor(sisyphus): drop test-only release exports and tighten release tests
  <details>
  <summary>Details</summary>

  Test npm dist-tags through getNpmTag instead of a re-exported predicate,
  import the build-output matcher from its module, and pin the report schema
  version as a literal. Make the visibility default case use the real default,
  reject invalid timeouts before releasing, and cover resume with a real ledger.
  Replace resume push tests that could not detect a re-push with reconcile
  cases guarded by a rejecting pre-push hook, and share the fake registry
  environment so no test reads the developer's npm config or the public
  registry.
  </details>
- [`63d6583`](https://github.com/r5n-labs/clis/commit/63d6583) refactor(sisyphus): drop dead domain helpers and duplicated tests
  <details>
  <summary>Details</summary>

  isBumpType, Stone.withTag, withDescription, withCommits and the
  Commit.isConventional getter had no production callers and survived only
  through their tests. Remove them with the tests, drop Package and helper
  cases that replay VersionCalculator and ChangesetParser, move unique cases to
  their owners, and make the affectsPackage test exercise affectsPackage.
  </details>

</details>

### 🪨 Tests
**Packages:** `@r5n/cli-core` · `@r5n/tools` · `@r5n/argus` · `@r5n/hydra` · `@r5n/sisyphus`

<details>
<summary>Commits (9)</summary>

- [`1bbfb92`](https://github.com/r5n-labs/clis/commit/1bbfb92) test(core): cover the repeated-flag fallback in number conversion
  <details>
  <summary>Details</summary>

  Tokens such as -=n bypass the occurrence check, so convertNumbers still has to
  reject repeated values; pin that path so it is not removed as dead code.
  </details>
- [`e671f21`](https://github.com/r5n-labs/clis/commit/e671f21) test(tools): drop an ignored-input case covered by stronger tests
  <details>
  <summary>Details</summary>

  The removed case cannot fail without the build-output or submodule cases
  failing as well.
  </details>
- [`a640f68`](https://github.com/r5n-labs/clis/commit/a640f68) test(argus): keep gettext cases with the gettext parser tests
  <details>
  <summary>Details</summary>

  Move the gettext context, plural and source location cases out of the GDScript
  tests and drop a row that duplicated the trailing garbage case.
  </details>
- [`57654d4`](https://github.com/r5n-labs/clis/commit/57654d4) test(hydra): fold cleanup option checks into the mutating options table
  <details>
  <summary>Details</summary>

  Every row now asserts its exit code and output and that a _work marker
  survives, including the dry-run cleanup that previously had its own file.
  </details>
- [`80d2fe9`](https://github.com/r5n-labs/clis/commit/80d2fe9) test(sisyphus): drive prompt tests through execute and cover publish-only visibility
  <details>
  <summary>Details</summary>

  Replace private method overrides in the version and init tests with mocked
  prompts at the command boundary, keep the init ordering regression, name the
  root attribution test after its intended behaviour, fold the 0.0.x range rows
  into the caret table, and cover the registry visibility check on publish-only
  releases.
  </details>
- [`2b030fb`](https://github.com/r5n-labs/clis/commit/2b030fb) test(sisyphus): run the provider release resume through a CLI subprocess
  <details>
  <summary>Details</summary>

  Bun 1.3.14 resolves Bun.$ commands from the PATH it started with, so the gh
  shim prepended to process.env.PATH was ignored on CI and the test reached the
  real gh with the runner's credentials. Run sis roll --resume in a subprocess
  that receives the shim PATH and an isolated Git config at spawn time, as the
  other provider tests do, and document the pitfall.
  </details>
- [`3c2099d`](https://github.com/r5n-labs/clis/commit/3c2099d) test(sisyphus): isolate global git config in the GitHub remote helper
  <details>
  <summary>Details</summary>

  The provider release test records a github.com destination, but a global
  url.insteadOf rule on the CI runner rewrote the push URL and failed the
  remote check. Point GIT_CONFIG_GLOBAL at an empty file and disable the
  system config while the routed remote is active, and restore PATH and the
  git environment through the helper.
  </details>
- [`f68e926`](https://github.com/r5n-labs/clis/commit/f68e926) test(argus): remove duplicated and circular review tests
  <details>
  <summary>Details</summary>

  Drop an HTML report test whose contracts belong to stronger viewer, render and
  snapshot tests, remove a fingerprint assertion computed by the helper under
  test, fold the comment preset upgrade into the config upgrade table with the
  missing naming row, and keep only the translation row that proves decoding.
  </details>
- [`cd85ce2`](https://github.com/r5n-labs/clis/commit/cd85ce2) test(core): remove duplicated CLI and parser tests
  <details>
  <summary>Details</summary>

  Drop a router test that repeats the non-terminal subprocess check, replace a
  negative assertion that could never fail with the real menu prompt, fold the
  older repeated-flag tests into the occurrence tables while keeping the Exit
  contract, and collapse deepMerge cases into one table.
  </details>

</details>

### 🪨 CI
**Packages:** `@r5n/tools`

<details>
<summary>Commits (1)</summary>

- [`9f3c0a6`](https://github.com/r5n-labs/clis/commit/9f3c0a6) ci: persist the release ledger across release re-runs
  <details>
  <summary>Details</summary>

  The self-hosted fleet runs a re-run on any runner instance, so the ledger of a
  failed release was missing and the job started a new release. Reset local
  release state, restore the run's cached ledger and save it after the roll so
  re-running failed jobs resumes the same release.
  </details>

</details>

### 🪨 Chores
**Packages:** `@r5n/atlas`

<details>
<summary>Commits (1)</summary>

- [`0d7e2ce`](https://github.com/r5n-labs/clis/commit/0d7e2ce) chore: align Bun pins with the runner's Bun 1.4.2
  <details>
  <summary>Details</summary>

  The self-hosted runner now provides Bun 1.4.2, which the release workflow
  uses directly. Pin CI, packageManager and @types/bun to the same version so
  tests, builds and releases run on one runtime.
  </details>

</details>

## 2026-10-05 - @r5n/sisyphus@0.13.0

**Packages**
- ✨ `@r5n/sisyphus` 0.12.2 → 0.13.0

### 🪨 Features
**Packages:** `@r5n/sisyphus`

<details>
<summary>Commits (1)</summary>

- [`0dc422e`](https://github.com/r5n-labs/clis/commit/0dc422e) feat(sisyphus): verify npm visibility after publishing
  <details>
  <summary>Details</summary>

  npm can accept a publication and only list the version minutes or hours
  later, so a successful npm publish no longer proves that a release reached
  the registry. Add release.npmVisibilityTimeout to poll each released version
  and compare its integrity with the packed artifact. Late or mismatched
  versions become report warnings and visible flags instead of failing an
  irreversible release, and the check stays off by default.
  </details>

</details>

## 2026-10-04 - @r5n/argus@0.3.3, @r5n/atlas@0.6.3, @r5n/hydra@0.11.2, @r5n/sisyphus@0.12.2

**Packages**
- 🐛 `@r5n/argus` 0.3.2 → 0.3.3
- 🐛 `@r5n/atlas` 0.6.2 → 0.6.3
- 🐛 `@r5n/hydra` 0.11.1 → 0.11.2
- 🐛 `@r5n/sisyphus` 0.12.1 → 0.12.2

### 🪨 Publish the redesigned logos
**Packages:** `@r5n/argus` · `@r5n/atlas` · `@r5n/hydra` · `@r5n/sisyphus`

<details>
<summary>Description</summary>

  The previous patch was tagged in git but never reached npm because trusted publishing was not yet configured for Argus and Atlas.
</details>

## 2026-10-04 - @r5n/argus@0.3.2, @r5n/atlas@0.6.2, @r5n/hydra@0.11.1, @r5n/sisyphus@0.12.1

**Packages**
- 🐛 `@r5n/argus` 0.3.1 → 0.3.2
- 🐛 `@r5n/atlas` 0.6.1 → 0.6.2
- 🐛 `@r5n/hydra` 0.11.0 → 0.11.1
- 🐛 `@r5n/sisyphus` 0.12.0 → 0.12.1

### 🪨 Documentation
**Packages:** `@r5n/argus` · `@r5n/atlas` · `@r5n/hydra` · `@r5n/sisyphus`

<details>
<summary>Commits (1)</summary>

- [`cee4b11`](https://github.com/r5n-labs/clis/commit/cee4b11) docs: redesign CLI logos as geometric marks
  <details>
  <summary>Details</summary>

  Replace the uneven silhouettes with one family of bold, minimal marks that
  share a palette and a single terracotta accent, so every logo stays legible
  at README and favicon sizes. Drop the unused Sisyphus PNG because only the
  SVG logos are referenced.
  </details>

</details>

## 2026-10-03 - @r5n/argus@0.3.1, @r5n/atlas@0.6.1

**Packages**
- 🐛 `@r5n/argus` 0.3.0 → 0.3.1
- 🐛 `@r5n/atlas` 0.6.0 → 0.6.1

### 🪨 Chores
**Packages:** `@r5n/argus` · `@r5n/atlas`

<details>
<summary>Commits (1)</summary>

- [`7f3d092`](https://github.com/r5n-labs/clis/commit/7f3d092) chore: enable public Argus and Atlas releases (#45)
  <details>
  <summary>Details</summary>

  Remove the private flags from Argus and Atlas so Sisyphus can publish both bundled CLIs. Declare Argus's public registry and repository metadata, and include the complete repository licence in Atlas's archive.
  
  Document global installation and installed commands, with npm-compatible guide links and separate source development instructions.
  </details>

</details>

## 2026-10-03 - @r5n/argus@0.3.0, @r5n/atlas@0.6.0, @r5n/hydra@0.11.0, @r5n/sisyphus@0.12.0

**Packages**
- ✨ `@r5n/argus` 0.2.0 → 0.3.0
- ✨ `@r5n/atlas` 0.5.0 → 0.6.0
- ✨ `@r5n/hydra` 0.10.0 → 0.11.0
- ✨ `@r5n/sisyphus` 0.11.0 → 0.12.0

### 🪨 Features
**Packages:** `@r5n/argus` · `@r5n/atlas` · `@r5n/hydra` · `@r5n/sisyphus`

<details>
<summary>Commits (1)</summary>

- [`6559a38`](https://github.com/r5n-labs/clis/commit/6559a38) feat(argus): support Cloudflare models and refresh CLI guides (#44)
  <details>
  <summary>Details</summary>

  Allow Argus to use Cloudflare Clef and Clef Flash through a shared evaluator, with provider-aware limits, canonical model identities and saved-response recovery.
  
  Make the CLI entry points easier to read with concise READMEs, linked reference guides and recognisable mythological logos for Sisyphus, Hydra, Atlas and Argus.
  
  Install the repository-local test-audit skill, repair recovery coverage to exercise real interrupted runs and remove a duplicate validation case.
  </details>

</details>

## 2026-10-03 - @r5n/argus@0.2.0, @r5n/atlas@0.5.0, @r5n/cli-core@0.5.0, @r5n/hydra@0.10.0, @r5n/sisyphus@0.11.0, @r5n/tools@0.3.0

**Packages**
- ✨ `@r5n/argus` 0.1.0 → 0.2.0
- ✨ `@r5n/atlas` 0.4.2 → 0.5.0
- ✨ `@r5n/cli-core` 0.4.4 → 0.5.0
- ✨ `@r5n/hydra` 0.9.4 → 0.10.0
- ✨ `@r5n/sisyphus` 0.10.0 → 0.11.0
- ✨ `@r5n/tools` 0.2.2 → 0.3.0

### 🪨 Features
**Packages:** `@r5n/argus` · `@r5n/atlas` · `@r5n/cli-core` · `@r5n/hydra` · `@r5n/sisyphus` · `@r5n/tools`

<details>
<summary>Commits (1)</summary>

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

</details>

### 🪨 Chores
**Packages:** `@r5n/cli-core` · `@r5n/sisyphus`

<details>
<summary>Commits (1)</summary>

- [`4632c71`](https://github.com/r5n-labs/clis/commit/4632c71) chore: json format

</details>

## 2026-09-16 - @r5n/atlas@0.4.2, @r5n/cli-core@0.4.4, @r5n/hydra@0.9.4, @r5n/sisyphus@0.10.0, @r5n/tools@0.2.2

**Packages**
- 🐛 `@r5n/atlas` 0.4.1 → 0.4.2
- 🐛 `@r5n/cli-core` 0.4.3 → 0.4.4
- 🐛 `@r5n/hydra` 0.9.3 → 0.9.4
- ✨ `@r5n/sisyphus` 0.9.1 → 0.10.0
- 🐛 `@r5n/tools` 0.2.1 → 0.2.2

### 🪨 Features
**Packages:** `@r5n/sisyphus`

<details>
<summary>Commits (2)</summary>

- [`8628434`](https://github.com/r5n-labs/clis/commit/8628434) feat(sisyphus): add roll --json for CI consumption
  <details>
  <summary>Details</summary>

  `roll` reported only a package count, so a workflow could not learn what
  was published without parsing human output. Everything needed was
  already in the release ledger — package names, old and new versions,
  per-package npm state, registries, artifact integrity, tags, stones —
  and simply never surfaced.
  
  Add a pure report builder over the ledger and a --json flag covering
  every roll mode: release, dry run, preview, publish-only, resume and
  abort. In JSON mode a single document goes to stdout, clack output is
  suppressed rather than interleaved, confirmations are skipped, and a
  failure still emits a report — including the packages that did publish
  before the failure — with human diagnostics on stderr and the same exit
  code as before.
  
  The report is versioned and always emits every field, using null and []
  rather than omission, so jq never has to distinguish absent from null.
  
  This repo's own release workflow now reads it instead of the deleted
  dist workaround, and exposes published/publishedPackages as job outputs.
  </details>
- [`acf9977`](https://github.com/r5n-labs/clis/commit/acf9977) feat(sisyphus): make the release build configurable
  <details>
  <summary>Details</summary>

  The per-package build was a hardcoded `bun run build` with no way to
  change it, disable it, or run anything at the repository root, and both
  pack guards rejected every gitignored file outright. A monorepo whose
  declarations are generated centrally therefore had no way to publish
  complete packages: it could only pack without the declarations, or be
  rejected for having pre-built ones. This repo worked around it in CI by
  deleting packages/*/dist after building.
  
  Add release.build with an argv command for the per-package build, argv
  arrays run once at the repository root before the first pack, and a list
  of globs declaring what the build writes. Declared outputs are cleaned
  before the root build and exempted from the ignored-input and pack-input
  guards; everything else stays rejected, and a declared output that Git
  tracks is refused before any build runs.
  
  Commands are spawned with an argv array rather than through a shell, so
  config strings carry no injection surface, and an absent command still
  defaults to `bun run build` so existing configs behave exactly as before.
  
  The root build runs inside the same commit-bound window as the rest of
  the pipeline: it is bound to the release commit, refuses to change
  tracked source, and does not re-run on resume when every artifact is
  already in the ledger.
  </details>

</details>

### 🪨 Bug fixes
**Packages:** `@r5n/sisyphus` · `@r5n/tools` · `@r5n/hydra` · `@r5n/cli-core` · `@r5n/atlas`

<details>
<summary>Commits (12)</summary>

- [`eafb119`](https://github.com/r5n-labs/clis/commit/eafb119) fix(sisyphus): preserve release plans and reconcile interrupted publication
  <details>
  <summary>Details</summary>

  Keep prerelease graduation and dependency ordering consistent across previews, release PRs and archived plans. Reject invalid stones, tags, commit baselines and foreign PR URLs before they can produce incomplete releases. Recover interrupted pushes without overwriting divergent refs, validate immutable publication settings before external actions, and preserve local work during CI release preparation.
  </details>
- [`a34aee1`](https://github.com/r5n-labs/clis/commit/a34aee1) fix(hydra): preserve runner state across lifecycle failures
  <details>
  <summary>Details</summary>

  Track completed registrations and removals as they happen so partial failures remain recoverable. Publish only complete downloads, stop the selected detached process group, update each stale runner and reject unknown options before mutation. Keep runner binaries under explicit Hydra update control.
  </details>
- [`d6804ce`](https://github.com/r5n-labs/clis/commit/d6804ce) fix(core): validate CLI input and preserve persisted configuration
  <details>
  <summary>Details</summary>

  Reject malformed numeric options and unsafe interactive routing before commands can apply destructive defaults. Preserve declared negated aliases and provide command-scoped option checks without breaking passthrough. Save configuration atomically, retain unreadable files and isolate nested defaults; include framework tests in type checking.
  </details>
- [`cb068b9`](https://github.com/r5n-labs/clis/commit/cb068b9) fix(tools): preserve setup state and immutable publication settings
  <details>
  <summary>Details</summary>

  Keep frozen lockfiles during retries, install setup dependencies before hooks run, and preserve existing workspace catalogues and scripts. Honour access and prerelease channels from packed manifests, keep dry runs offline, and make builder and packing failures deterministic and recoverable. Resume saved releases even after their pending stones have been archived.
  </details>
- [`d0892b1`](https://github.com/r5n-labs/clis/commit/d0892b1) fix(atlas): validate command inputs and write private files atomically
  <details>
  <summary>Details</summary>

  Reject misspelled options and malformed profile references before selecting defaults or writing files. Preserve existing files on failed writes, report configuration errors consistently in JSON mode, and distinguish missing commands from invalid working directories.
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
- [`20eb27e`](https://github.com/r5n-labs/clis/commit/20eb27e) fix(sisyphus): make roll --json output trustworthy
  <details>
  <summary>Details</summary>

  Three unrelated code paths wrote to stdout during a JSON roll — an
  unguarded cycle warning in publish-only, StoneManager's malformed-stone
  warning, and a gh release create call missing .quiet() — any of which
  corrupted the document a CI job parses. Rather than chase each caller,
  JSON mode now routes stdout to stderr for the duration of the run and
  restores it only to print the report, so no library can pollute it. The
  gh call is quietened regardless.
  
  A --resume that failed reported an empty release: the report context was
  assigned only after resume() returned, so a partial publish emitted
  published:false with no packages while versions were live on the
  registry. The failure path now falls back to the active ledger.
  
  The report also claimed tags that were never created, because the ledger
  records them at plan time; it now reports them only once tagging is
  confirmed. Failure reports carry the cause chain, which previously
  existed only on the human path via logErrorCauses.
  
  The release workflow no longer discards the report when the roll fails —
  it prints it, still writes the job outputs, and then exits with the
  roll's status, so a partial publish is visible instead of vanishing with
  the runner temp directory.
  
  Also: the release build config validates array shape and rejects '..'
  inside output globs, the cycle fallback in orderForRelease breaks the
  most-blocking node instead of dumping the remainder alphabetically (so a
  satisfiable constraint is no longer violated and only forced nodes are
  reported), and packages/sisyphus/tsconfig.json finally includes tests/ —
  which was hiding six type errors, one of them the reason the new build
  tests never exercised a configured build.
  </details>
- [`dd05b10`](https://github.com/r5n-labs/clis/commit/dd05b10) fix(sisyphus): close defects found reviewing the release-correctness work
  <details>
  <summary>Details</summary>

  Archived stones are now written from the planned stone rather than
  renamed from disk, so a stone that config.ignore strips still hashes
  identically when roll --publishOnly replays it. Without this, any
  repository using ignore hit "Prepared release plan has changed" after
  its release PR merged.
  
  An emptied stone no longer constrains the release channel, and a release
  PR whose stones reference nothing releasable now skips instead of
  failing the job. sis pr skips the same way when every affected package
  is ignored.
  
  Leaving a prerelease is decided per release, not per package: a
  dependency bump keeps its channel unless the release itself is
  graduating, which it is when an explicitly selected package is leaving a
  prerelease. The previous commit graduated unconditionally, which would
  have shipped an unrelated in-flight rc as stable; before that,
  dependents were stranded on the channel their dependency had left.
  
  The npm dist-tag derivation no longer truncates hyphenated tags into a
  shared channel, and refuses to fall back to the configured stable tag
  when a prerelease has no valid dist-tag, instead of silently publishing
  a prerelease as latest.
  
  Also: a caret range on a 0.0.x version is invalidated by a minor bump; a
  prerelease tag must be a single identifier, so "beta.4" can no longer
  produce a version lower than the current one; commits without a package
  list no longer crash the merge; semver rejects numeric identifiers past
  MAX_SAFE_INTEGER; changeset migration reports unsupported bump types
  instead of dropping the package; and roll --json reports the dist-tag
  the release will actually publish with.
  </details>
- [`a86ea07`](https://github.com/r5n-labs/clis/commit/a86ea07) fix(sisyphus): graduate dependents when a release leaves a prerelease
  <details>
  <summary>Details</summary>

  A dependency bump preserved whatever prerelease channel the package was
  already on, so an untagged release moved the directly selected packages
  to stable while every induced dependent stayed on the channel. A stable
  2.0.0 shipped alongside dependents pinned to it at 1.0.2-beta.3.
  
  Since a merged release must now agree on one prerelease tag, an untagged
  stone unambiguously means "go stable", and every package in it should
  leave the channel. Drop the special case: a dependency bump follows the
  release channel like any other bump.
  </details>
- [`74707c5`](https://github.com/r5n-labs/clis/commit/74707c5) fix(sisyphus): correct prerelease arithmetic and stone merging
  <details>
  <summary>Details</summary>

  VersionCalculator passed the base version through untouched whenever a
  prerelease tag was present and never read the bump at all, so 1.0.0 with
  a minor bump and a beta tag produced 1.0.0-beta.1: a version that sorts
  below the already published 1.0.0, and one where a breaking change was
  indistinguishable from a typo fix. Parsing was split() and parseInt with
  no validation, so "invalid" produced NaN.0.1 and PackageUpdater wrote it
  straight into package.json.
  
  Add a strict semver module and rebuild the calculator on node-semver inc
  semantics, where a release-level increment applied to a version that
  already carries a prerelease drops the prerelease onto the core instead
  of advancing it. Because the core already encodes base plus accumulated
  bump, entering, continuing, escalating and leaving a prerelease all come
  out right with no persisted state:
  
    1.0.0        + minor + beta => 1.1.0-beta.0
    1.1.0-beta.0 + patch + beta => 1.1.0-beta.1
    1.1.0-beta.1 + major + beta => 2.0.0-beta.0
    1.1.0-beta.1 + patch        => 1.1.0
  
  Every stable path is unchanged. Invalid versions, unknown bump types, a
  normal bump applied to a snapshot version, and a prerelease tag that
  would move a version backwards are now rejected before anything is
  written.
  
  Stone.merge omitted Snapshot from its collect loop, so snapshot packages
  vanished whenever a second stone was pending, and it resolved
  conflicting prerelease tags by silently taking the first, applying it to
  every package in the merge. Snapshots are now collected, a package
  requested as both a snapshot and a normal release is a hard error, and
  the merge set must be tag homogeneous. Commits dedupe by hash with their
  package attribution unioned, and mergeAll no longer short-circuits on a
  single stone, so one stone listing a package under two bump keys can no
  longer produce a duplicate git tag mid-release.
  
  The npm dist-tag now follows the release channel instead of publishing
  every prerelease as latest.
  </details>
- [`d5ff33e`](https://github.com/r5n-labs/clis/commit/d5ff33e) fix(sisyphus): propagate dependents transitively and honour ignore
  <details>
  <summary>Details</summary>

  Dependent discovery walked exactly one hop from the initially selected
  packages, so a change to a package deep in the graph left its indirect
  consumers pinned to a stale version. It also derived edges from
  dependencies and devDependencies only, ignoring peerDependencies and
  optionalDependencies, which PublishManifest resolves at pack time.
  
  Replace findDependencyPackages with a worklist that runs to a fixed
  point over the bump lattice, so cycles terminate and output is sorted.
  Package now carries the workspace edges it declares, with the kind and
  the specifier retained, and WorkspaceScanner no longer owns graph
  semantics.
  
  Release-bearing edge kinds and range awareness are configurable via the
  new dependents config. Both defaults reproduce today's release sets:
  every kind is release bearing, and every dependent is released
  regardless of whether its published range still admits the new version.
  devDependencies stay in the defaults because bundled CLIs inline their
  workspace dependencies at build time.
  
  config.ignore was written by migrate but read nowhere. It is now
  enforced when seeding, when propagating, and when materialising a
  release plan, and propagation never traverses through an ignored
  package.
  
  Release sets are now topologically ordered so a dependency is tagged and
  published before the dependent that pins it.
  </details>

</details>

### 🪨 Tests
**Packages:** `@r5n/sisyphus`

<details>
<summary>Commits (2)</summary>

- [`6b41476`](https://github.com/r5n-labs/clis/commit/6b41476) test(sisyphus): make the pack-race fixtures deterministic
  <details>
  <summary>Details</summary>

  The pack watcher slept 100 ms and hoped the orchestrator was mid-pack by
  then; under load the mutation landed before the post-build source check
  and the test reported the wrong guard. Wait for the staging directory
  the orchestrator creates right before packing instead, which pins the
  mutation to the window the test is actually about.
  
  Raise the bun test timeout to 30 s: the release suites spawn git, npm and
  bun per test and exceed the 5 s default on a busy runner.
  </details>
- [`5353552`](https://github.com/r5n-labs/clis/commit/5353552) test(sisyphus): pin the archived-stone fix and close review leftovers
  <details>
  <summary>Details</summary>

  The archive fix shipped without a regression test; add one that fails
  against the previous rename-the-file behaviour and passes against the
  written-from-plan behaviour.
  
  Also: drop the unreachable Exit around Bun.Glob matching rather than
  leave dead error handling, kill the build subprocess if draining its
  streams rejects, and report the release commit for a release that
  creates no ledger, so a tags-only roll --json no longer says null.
  </details>

</details>

### 🪨 Build
**Packages:** `@r5n/sisyphus`

<details>
<summary>Commits (1)</summary>

- [`243d6bc`](https://github.com/r5n-labs/clis/commit/243d6bc) build(sisyphus): raise the bundle budget to 256 KB
  <details>
  <summary>Details</summary>

  The release-correctness work grew the bundle to 245 KB, past the 240 KB
  guard, so the build failed on a clean checkout.
  </details>

</details>

### 🪨 Chores
**Packages:** `@r5n/tools`

<details>
<summary>Commits (1)</summary>

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

</details>

### 🪨 Tests
**Packages:** `@r5n/tools`

<details>
<summary>Commits (1)</summary>

- [`e9b35d1`](https://github.com/r5n-labs/clis/commit/e9b35d1) test(tools): restore PATH when delegating npm calls
  <details>
  <summary>Details</summary>

  A package-manager dispatcher can resolve npm by name after removing its own shim directory. Keeping the test interception directory on that path re-enters the interceptor and can hang indefinitely. Delegate with the original PATH and include captured subprocess output in failure diagnostics.
  </details>

</details>

### 🪨 CI
**Packages:** `@r5n/tools`

<details>
<summary>Commits (1)</summary>

- [`1a827f2`](https://github.com/r5n-labs/clis/commit/1a827f2) ci: isolate Bun installations for concurrent runners
  <details>
  <summary>Details</summary>

  Self-hosted jobs share a home directory, so restoring Bun into the default path can overwrite an executable another job is starting. Install the selected version beneath each job's temporary directory and reuse the workspace setup action for frozen dependency installation.
  </details>

</details>

## 2026-08-03 - @r5n/atlas@0.4.1, @r5n/cli-core@0.4.3, @r5n/sisyphus@0.9.1, @r5n/tools@0.2.1, @r5n/hydra@0.9.3

**Packages**
- 🐛 `@r5n/atlas` 0.4.0 → 0.4.1
- 🐛 `@r5n/cli-core` 0.4.2 → 0.4.3
- 🐛 `@r5n/sisyphus` 0.9.0 → 0.9.1
- 🐛 `@r5n/tools` 0.2.0 → 0.2.1
- 📦 `@r5n/hydra` 0.9.2 → 0.9.3

### 🪨 Bug fixes
**Packages:** `@r5n/atlas` · `@r5n/cli-core` · `@r5n/sisyphus` · `@r5n/tools`

<details>
<summary>Commits (1)</summary>

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

</details>

## 2026-07-28 - @r5n/atlas@0.4.0, @r5n/sisyphus@0.9.0, @r5n/cli-core@0.4.2, @r5n/hydra@0.9.2

**Packages**
- ✨ `@r5n/atlas` 0.3.0 → 0.4.0
- ✨ `@r5n/sisyphus` 0.8.2 → 0.9.0
- 🐛 `@r5n/cli-core` 0.4.1 → 0.4.2
- 🐛 `@r5n/hydra` 0.9.1 → 0.9.2

### 🪨 feat: harden profile and release workflows
**Packages:** `@r5n/atlas` · `@r5n/sisyphus` · `@r5n/cli-core` · `@r5n/hydra`

<details>
<summary>Description</summary>

  Release commits now require a valid commit.email whenever commit.author is set; rolls fail early with 'Invalid release commit author' instead of git's pattern-search fallback. Configs written by older 'sis init' inherit the default email automatically; set both keys, or clear both, to control the release identity.
</details>

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
