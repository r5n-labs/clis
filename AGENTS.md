# R5N CLI Monorepo - Agent Guidelines

Bun + TypeScript monorepo of zero-dependency, single-file CLIs built on one private framework. `CLAUDE.md` is a gitignored symlink to this file: edit `AGENTS.md`.

## Quick Reference

| Task | Command |
|------|---------|
| Build all CLIs | `bun run build` |
| Build one package | `bun --filter @r5n/sisyphus build` |
| Lint and format (writes) | `bun lint` |
| Lint read-only | `bun biome check` |
| Type check every workspace | `bun type-check` |
| Run all tests (sequential, ~65 s) | `bun test` |
| Run one test file | `bun test packages/sisyphus/tests/domain/semver.test.ts` |
| Run tests by name | `bun test -t "pattern"` |
| Lint workflows | `actionlint` (config in `.github/actionlint.yaml`) |
| Clean and reinstall | `bun clean` |
| Run a CLI from source | `bun sis <command>` / `bun hydra <command>` / `bun atlas <command>` |
| Debug a CLI | `bun sis:dbg <command>` (also `hydra:dbg`, `atlas:dbg`) |

## Core Mandates

- **Runtime:** use `bun` for every script, install and test. Never `npm`, `yarn`, `pnpm` or `bunx`. The release path and its tests shell out to the real `git` and `npm` binaries by design; never publish by hand with bare `npm publish`.
- **Formatting:** Biome owns formatting and import order. `bun lint` rewrites files (`--write --unsafe`); CI runs the same command, so use `bun biome check` when you need a read-only verdict.
- **Validation:** `banditypes` (imported from `banditypes`), never Zod. Today only atlas validates its config with it; new runtime validation must use it too.
- **Architecture:** each CLI bundles `@r5n/cli-core` and `@r5n/tools` at build time and ships one executable file with no runtime dependencies.
- **Comments:** none unless explicitly requested; code must be self-documenting.
- **File size:** files over ~1000 lines are unacceptable; split along module seams.
- **Commits:** conventional commits, British English, imperative subject, body explains why. Never add AI attribution or co-author trailers.
- **Docs:** British English in README, comments and commit messages.

## Project Structure

```
packages/
  core/      @r5n/cli-core  private framework: AbstractCLI, commands, args, prompts, ConfigManager, Exit
  sisyphus/  @r5n/sisyphus  published: monorepo versioning and releases via "stones" (bins: sis, sisyphus)
  hydra/     @r5n/hydra     published: self-hosted GitHub Actions runner fleet manager
  atlas/     @r5n/atlas     private (unreleased): profile-based env composition (init, profiles, run, export)
tools/       @r5n/tools     private: bunPackageBuilder, publish scripts, shared tsconfig/biome, CI composite action
```

`tools/` is an ordinary tracked directory. The `.gitmodules` entry is historical and inert; `git submodule update` is a no-op. Consumers deep-import `@r5n/tools/builder` and `@r5n/tools/typescript/base.json` through the workspace symlink.

Each CLI package has the same scripts: `dev` (`bun --bun src/cli.ts`), `build` (`rm -rf dist && bun build.ts`), `type-check`, `package:prepare`, `package:dryRun` and `package:publish` (the last three run `tools/scripts/*` and must be invoked inside the package or via `bun --filter <name> <script>`; the root only has `package:prepare`).

Tests live in `packages/<name>/tests/` for core, sisyphus and hydra, colocated as `src/**/*.test.ts` in atlas, and next to the scripts in `tools/scripts/`.

## Versions and Pins

| Where | Value |
|-------|-------|
| `package.json` `packageManager` | `bun@1.3.3` |
| `.github/workflows/ci.yml` `BUN_VERSION` | `1.3.14` |
| `@types/bun` | `1.3.14` |
| Release workflow | the self-hosted runner's own bun; `npm@11` bootstrapped into `$RUNNER_TEMP` |
| Root devDependencies | exact pins (Biome, @clack/prompts, lefthook, TypeScript 7) |

Sisyphus and tools parse both the npm 11 and npm 12 output shapes of `npm pack --json` (array vs object keyed by name) and `npm view <name@version> --json` (object vs one-element array). Keep that in mind when touching `services/release/npm-*.ts` or `tools/scripts/package-artifact.ts`.

## Import Order (Biome-enforced)

```typescript
import fs from "node:fs";                          // 1. Node built-ins (node: prefix)
import { log } from "@clack/prompts";              // 2. External packages
import { AbstractCommand } from "@r5n/cli-core";   // 3. Workspace packages
import { bunPackageBuilder } from "@r5n/tools/builder";
import { $ } from "bun";                           // 4. Bun
import { BaseCommand } from "../base-command";     // 5. Relative imports
import type { Config } from "../types";            // 6. Type-only imports last
```

## Code Style

- **Formatting:** 2-space indent, 120-column lines, semicolons, double quotes, LF.
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `noImplicitReturns` (see `tools/typescript/base.json`).
- **Naming:** `camelCase` variables and functions, `PascalCase` classes, types and enums, `SCREAMING_SNAKE_CASE` constants, files `kebab-case.ts` or `PascalCase.ts` for class modules.
- **Return types:** omit when inferrable; add them on public APIs.
- **Magic numbers:** extract every literal into a named constant (`const DECIMAL_RADIX = 10;`).
- **Control flow:** return early, keep the main path unindented, prefer ternaries for values, exhaustive `switch` over enums.
- **Exports:** named exports only; barrels in `index.ts` re-export with `export * from "./Module";`.
- **Async:** no floating promises (Biome `noFloatingPromises`); always `await` or handle.

## Error Handling

```typescript
import { Exit } from "@r5n/cli-core";
throw new Exit("Package not found", "Run 'sis init' first");   // user-facing, exit code 1 by default
```

- `Exit` renders as a warning plus dimmed hint and sets the exit code; `Cancel` (dismissed prompt) exits 0. Plain `Error`s are programmer errors and print their cause chain via `logErrorCauses`.
- Wrap subprocess failures with context (`runInContext` in sisyphus) so messages carry operation, input and cause.
- Never swallow `.nothrow()` results silently; inspect `exitCode` and surface stderr.

## Command Pattern

```typescript
const checkArgs = args({
  json: { alias: "j", default: false, description: "Output as JSON", type: "boolean" },
});
type CheckCtx = Ctx<typeof checkArgs>;

export class CheckCommand extends BaseCommand {
  name = "check";
  description = "Show workspace packages";
  args = checkArgs;
  async execute(ctx: CheckCtx) { /* ... */ }
}
```

- `ctx.interactive` is `command.prompts && no positionals`; the framework does not check for a TTY. Commands that prompt must guard with `process.stdout.isTTY` before blocking (see `version.ts` and `roll.ts`).
- Global flags are `--help/-h`, `--interactive/-i`, `--version/-v`; `mri` accepts unknown flags silently, so validate anything security-relevant yourself.
- Enums carry associated data through `Record<Enum, T>` maps and `isX(value): value is X` type guards.

## Sisyphus Internals

- `domain/`: `semver` (strict parser and `inc`), `BumpType`, `Commit`, `Package` (workspace edges, `applyStone` with prerelease graduation), `Stone` (parse, serialise, merge, tag homogeneity).
- `services/`: `StoneManager` (stones in `.sisyphus/stones/`, archived on roll), `VersionCalculator`, `dependency-graph` (transitive dependents, `config.ignore`, topological order, cycle breaking), `release-plan`, `release-report` (the `roll --json` document), `ChangelogGenerator`, `CommitAnalyzer`, `PullRequestAnalyzer`, `PublishManifest`.
- `services/ReleaseOrchestrator.ts` plus `services/release/*` run the roll: verified release commit, tags, root and per-package build with declared outputs, immutable `npm pack` artifacts in a staging directory, atomic push, `npm publish --access public --ignore-scripts`, optional provider release. Every irreversible step is recorded in a ledger under `.git/sisyphus/release/` (`services/release-ledger/*`) so `sis roll --resume` and `--abort` can reconcile.
- `providers/`: GitHub via `gh`, GitLab via `GITLAB_TOKEN` or `glab`, Bitbucket unsupported.
- `commands/actions/templates/` ships the GitHub and GitLab CI workflows that `sis actions init` installs; `build.ts` copies them into `dist/templates`.

## Testing

- `bun test` runs everything sequentially; many sisyphus tests call `process.chdir` and mutate `process.env`, so never use `--concurrent`.
- Filesystem tests build fixtures with `mkdtempSync(join(tmpdir(), "<prefix>-"))` and remove them in `afterEach`. Sisyphus release tests create real git repositories, a fake npm registry via `Bun.serve({ port: 0 })`, and spawn `bun` and `npm` subprocesses. Helpers live in `packages/sisyphus/tests/helpers/`.
- `bunfig.toml` sets the per-test timeout to 30 s; release tests need it.
- Prerequisites on PATH: `git`, `npm` (11 or 12). `gh` and `glab` are never invoked by tests.
- Prefer integration tests over broad mocking; pin every bug fix with a regression test that fails on the previous behaviour.

## Git Hooks

`lefthook.yml` runs Biome in write mode on staged `*.{jsx,tsx,ts,js,json}` files before every commit and re-stages what it fixes (`stage_fixed: true`). Hooks are installed by lefthook's postinstall.

## CI

`.github/workflows/ci.yml` runs lint, type-check, test, build, integration (built CLI smoke) and a release check on the self-hosted `r5n-m2-ultra` runner. Pull requests check out `github.head_ref`. `actionlint` knows the runner label through `.github/actionlint.yaml`.

## Releases

Sisyphus releases this repo itself:

- Conventional commits become stones: `bun sis version --fromCommits -y` (stones live in `.sisyphus/stones/`; `bun sis check --json` lists them).
- Pushing pending stones to `develop` triggers `.github/workflows/release.yml`: it rolls with `bun sis roll --json --yes` (or `--resume --json` when `.git/sisyphus/release/active.json` exists), prints the JSON report, exposes `published` and `publishedPackages` as job outputs and exits with the roll's status. The workflow skips its own `release(🎉):` commits.
- npm auth is trusted publishing (OIDC): `id-token: write`, npm 11 bootstrapped in the workflow, `NPM_CONFIG_PROVENANCE=false` because the self-hosted runner cannot sign provenance.
- `private: true` packages (core, tools, atlas) get version bumps and tags but are never published.
- `.sisyphus/config.json` declares the release build (`bun run build`, outputs `packages/*/dist/**`); undeclared gitignored files block `roll --npm` and `package:dryRun`, so run those from a pristine `git worktree add` when the checkout carries `dist/`, `.DS_Store` or `CLAUDE.md`.
- Manual per-package publishing goes through `package:publish` / `package:dryRun`, which use `tools/scripts/publish-package.ts` to resolve `workspace:` and `catalog:` protocols, pack an immutable artifact and restore `package.json` even on failure. The pure manifest logic is in `tools/scripts/publish-manifest.ts` (tested).
