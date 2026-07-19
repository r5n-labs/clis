<div align="center">

# ⚡ R5N CLIs

**Greek myths for modern toil.**

Developer tooling named after the figures who knew something about repetitive work —
built to make ours disappear.

[![CI](https://github.com/r5n-labs/clis/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/r5n-labs/clis/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE) [![Runtime](https://img.shields.io/badge/runtime-bun-f9f1e1.svg)](https://bun.sh)

</div>

---

Command-line tools we built to run our own projects, released for anyone with the same problems: versioning a monorepo without ceremony, running self-hosted CI runners without babysitting them, and (soon) never copy-pasting a config again.

Everything is TypeScript on [Bun](https://bun.sh), built on one shared framework, shipped as a single bundled file per tool — zero runtime dependencies. Every CLI works both as a scriptable command and as an interactive menu (`-i`).

## Pantheon

### 🪨 [Sisyphus](packages/sisyphus) — monorepo versioning and releases

[![npm](https://img.shields.io/npm/v/@r5n/sisyphus.svg?label=%40r5n%2Fsisyphus)](https://www.npmjs.com/package/@r5n/sisyphus)

Condemned to roll releases uphill forever — so he got good at it. Version changes are recorded as **stones**: small markdown files describing which packages bump and why (think changesets, with less ritual). Stack them as you work, then roll everything at once — version bumps, changelogs, git tags, npm publish, GitHub release.

```bash
bun add -g @r5n/sisyphus

sis version --fromCommits   # turn conventional commits into stones
sis check                   # see what's pending
sis roll                    # the boulder goes up
```

Sisyphus releases this very repo: pending stones pushed to `develop` are rolled automatically by [CI](.github/workflows/release.yml) with npm trusted publishing (OIDC) — no registry tokens stored anywhere.

### 🐍 [Hydra](packages/hydra) — self-hosted GitHub Actions runners

[![npm](https://img.shields.io/npm/v/@r5n/hydra.svg?label=%40r5n%2Fhydra)](https://www.npmjs.com/package/@r5n/hydra)

Cut off one head, two grow back. Hydra provisions and manages fleets of GitHub Actions runners on your own hardware: downloads the runner once per version and hardlinks it into each instance, registers through the `gh` CLI (no PATs to paste), and keeps every head inspectable.

```bash
bun add -g @r5n/hydra

hydra init          # set up a profile for a repo/org
hydra create        # grow some heads
hydra status        # who's alive, who's stuck
hydra logs          # tail the latest job's logs when something crashes
```

### 🌍 [Atlas](packages/atlas) — env/config profiles · *in development*

Holds your world up. Compose named configuration profiles — inheritance, dotenv files, secret references — and inject them into any process or render them to files. Aimed at ending config copy-paste between machines and AI coding tools. Unreleased; the v1 rebuild lands via [PR #12](https://github.com/r5n-labs/clis/pull/12).

### ⚙️ [cli-core](packages/core) — the shared framework · *internal*

Commands, typed args, interactive prompts, config persistence, and error handling behind all of the above. Bundled into each CLI at build time, never published.

## Development

Requires Bun. The `tools/` directory is a git submodule.

```bash
git clone git@github.com:r5n-labs/clis.git && cd clis
git submodule update --init --recursive
bun install

bun test              # all tests
bun lint              # biome check + format
bun type-check:ci     # type-check every package
bun run build         # bundle all CLIs

bun sis <command>     # run sisyphus from source
bun hydra <command>   # run hydra from source
```

Working on this codebase with an AI agent? Point it at [AGENTS.md](AGENTS.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).

<div align="center">
<sub>Built by <a href="https://github.com/r5n-labs">r5n-labs</a> — for the work that never ends.</sub>
</div>
