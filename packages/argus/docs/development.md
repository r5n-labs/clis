# Development

[Argus](../README.md) / Development

## Run from source

Clone the monorepo and install its dependencies:

```sh
git clone https://github.com/r5n-labs/clis.git
cd clis
bun install
bun argus --help
```

Use `bun argus` in place of the installed `argus` binary when developing in this checkout.

## Build and check

Run from the monorepo root:

```sh
bun test packages/argus/tests
bun --filter @r5n/argus type-check
bun --filter @r5n/argus build
bun packages/argus/scripts/smoke.ts
```

The build embeds the Tree-sitter runtime, GDScript, TypeScript, TSX and Godot resource grammars, and the gettext parser into `dist/cli.js`. The executable needs Bun, and Git for change checks, but no installed runtime packages or companion WASM files. The smoke command checks a copied executable against every parser and the embedded viewer without API calls.

The [Godot resource grammar](../src/formats/godot-resource/grammar/README.md) and [TypeScript/TSX grammars](../src/languages/typescript/grammar/README.md) are pinned, patched WASM assets with build provenance and rebuild instructions.

## Extend Argus

Language and format adapters extend `SourceAdapter`; framework integrations and review contributors provide evidence through explicit contracts. Model adapters implement a shared evaluation boundary. Dependency tests enforce the source-analysis boundaries. See [ARCHITECTURE.md](../ARCHITECTURE.md) for ownership and extension rules, and [models](models.md) for supported evaluation APIs.

Configuration and network boundaries use the monorepo's `banditypes` conventions. See [schema.json](../schema.json) for editor configuration support.
