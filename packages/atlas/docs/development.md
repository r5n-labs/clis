# Development

[Atlas](../README.md) / Development

## Run from source

Clone the monorepo and install its dependencies:

```sh
git clone https://github.com/r5n-labs/clis.git
cd clis
bun install
bun atlas --help
```

Use `bun atlas` in place of the installed `atlas` binary when developing in this checkout.

## Build and check

Run from the monorepo root:

```sh
bun test packages/atlas/src
bun --filter @r5n/atlas type-check
bun --filter @r5n/atlas build
bun packages/atlas/dist/cli.js --help
```

The build bundles runtime dependencies into `dist/cli.js`. The executable requires Bun.
