# R5N Tools - Agent Guidelines

`tools/` is the private `@r5n/tools` workspace in the CLI monorepo. The root `AGENTS.md` applies here. This is an ordinary tracked directory; the old submodule entry does not manage it.

## Commands

Run these from the repository root:

| Task | Command |
|------|---------|
| Type-check tools and their tests | `bun --filter @r5n/tools type-check` |
| Test the builder and scripts | `bun test tools` |
| Check formatting without writing | `bun biome check tools` |
| Initialise a monorepo | `bun --filter @r5n/tools setup-monorepo` |

The setup command writes missing configuration files, extends workspace membership and installs dependencies. Existing scripts and workspace catalogues are preserved. Run it only when setting up a repository.

## Structure

- `builder/index.ts`: shared Bun builder, type-check gate, bundle budgets and optional README badge updates. CLI packages import `@r5n/tools/builder` and bundle their runtime dependencies.
- `scripts/setup-monorepo.ts`: monorepo scaffolding and setup commands. Installation failures must fail the setup; retries must preserve the lockfile.
- `scripts/prepare-publish.ts` and `publish-manifest.ts`: resolve workspace and catalogue dependencies for publication.
- `scripts/publish-package.ts` and `package-artifact.ts`: verify committed source, prepare an immutable tarball, restore the manifest and publish that artifact. Use the package's `package:dryRun` or `package:publish` script.
- `github/setup/action.yml`: composite action for Bun setup and frozen dependency installation.
- `biome.json` and `typescript/base.json`: shared formatting, lint and strict TypeScript configuration.

## Conventions

Use Bun for scripts and tests. Biome owns formatting and import order: two spaces, 120 columns, double quotes and semicolons. Prefer named exports and explicit return types on public APIs. Add no comments unless requested.

Tests live beside builder and script modules. Publishing tests use real Git repositories and npm subprocesses; preserve source-integrity checks and cleanup. Both npm 11 and npm 12 JSON output shapes are supported. Use fixture directories outside the checkout and remove them after each test.
