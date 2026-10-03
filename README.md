<div align="center">

# R5N CLIs

**Greek myths. Everyday tools.**

Release packages, run your own CI, compose environments and review code.

[![CI](https://github.com/r5n-labs/clis/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/r5n-labs/clis/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE) [![Runtime](https://img.shields.io/badge/runtime-bun-f9f1e1.svg)](https://bun.sh)

</div>

Four command-line tools built with TypeScript and [Bun](https://bun.sh). Each bundles its runtime dependencies into one executable file, with scriptable commands and an interactive menu (`-i`).

## Choose a tool

| | Tool | What it does | Availability |
| --- | --- | --- | --- |
| <img src="packages/sisyphus/assets/logo.svg" width="48" alt="Sisyphus: a boulder on a slope"> | [**Sisyphus**](packages/sisyphus) | Version and release a monorepo from small JSON change records called stones. | [npm](https://www.npmjs.com/package/@r5n/sisyphus) |
| <img src="packages/hydra/assets/logo.svg" width="48" alt="Hydra: three serpent heads"> | [**Hydra**](packages/hydra) | Create and manage a fleet of self-hosted GitHub Actions runners. | [npm](https://www.npmjs.com/package/@r5n/hydra) |
| <img src="packages/atlas/assets/logo.svg" width="48" alt="Atlas: a globe held aloft"> | [**Atlas**](packages/atlas) | Combine environment profiles and pass them to a command or dotenv file. | Private; run from source |
| <img src="packages/argus/assets/logo.svg" width="48" alt="Argus: a watchful eye"> | [**Argus**](packages/argus) | Review code incrementally with configurable questions, cached model answers and independent verdicts. | Private; run from source |

## Get started

Install the published tools:

```sh
bun add -g @r5n/sisyphus @r5n/hydra
sis --help
hydra --help
```

For Atlas, Argus or development, clone this repository and run commands from its root:

```sh
git clone https://github.com/r5n-labs/clis.git
cd clis
bun install
bun atlas --help
bun argus --help
```

Each tool's README has its own quick start and reference guides. Argus supports [Jev and Cloudflare Clef models](packages/argus/docs/models.md); planning and report inspection work without API calls.

## Development

| Task | Command |
| --- | --- |
| Run a CLI from source | `bun sis`, `bun hydra`, `bun atlas`, `bun argus` |
| Run tests | `bun test` |
| Check formatting | `bun biome check` |
| Apply formatting | `bun lint` |
| Check types | `bun type-check` |
| Build all CLIs | `bun run build` |

[cli-core](packages/core) provides the shared command framework; [tools](tools) contains build and publishing utilities. Both are private and bundled into the CLIs. See [AGENTS.md](AGENTS.md) for repository conventions.

Sisyphus releases this repository: pending stones pushed to `develop` are rolled by the [release workflow](.github/workflows/release.yml), using npm trusted publishing.

## Licence

[Apache 2.0](LICENSE) · Built by [r5n-labs](https://github.com/r5n-labs).
