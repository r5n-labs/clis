# R5N CLI Tools

<div align="center">

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-%40r5n-red.svg)](https://www.npmjs.com/org/r5n)

Fast, zero-dependency CLI tools built with Bun.

</div>

## Packages

### [@r5n/hydra](packages/hydra) — GitHub Runner Manager

Manage self-hosted GitHub Actions runners without the pain.

```bash
# Spin up 5 runners with custom labels
hydra create -t $TOKEN -u github.com/org/repo -m 5 -l "docker,gpu"
```

**Key features:**
- Parallel runner creation
- Profile-based configs
- Live status monitoring
- 110KB bundle

### [@r5n/sisyphus](packages/sisyphus) — Monorepo Versioning

Stack version changes as "stones", release when ready.

```bash
# Create a version stone
sisyphus version

# Release everything
sisyphus roll --npm --github
```

**Key features:**
- Stone-based changesets
- Automatic dependency bumping
- One-command releases
- 164KB bundle

## Installation

```bash
# Install globally
bun add -g @r5n/hydra @r5n/sisyphus

# Or use directly
bunx @r5n/hydra --help
bunx @r5n/sisyphus --help
```

## Development

```bash
# Clone and install
git clone https://github.com/r5n-labs/clis.git
cd clis && bun install
git submodule update --init --recursive

# Build
bun run build

# Test
bun test

# Run locally
bun --bun packages/hydra/src/cli.ts
bun --bun packages/sisyphus/src/cli.ts
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict)
- **Validation:** Banditypes
- **Linting:** Biome
- **Build:** Custom bundler with zero runtime dependencies

## License

Apache 2.0 — see [LICENSE](./LICENSE)
