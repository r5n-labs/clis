# TypeScript and TSX grammars

These WASM assets use the official `tree-sitter-typescript` **0.23.2** source,
[revision `f975a621f4e7f532fe322e13c4f79495e0a7b2e7`](https://github.com/tree-sitter/tree-sitter-typescript/tree/f975a621f4e7f532fe322e13c4f79495e0a7b2e7),
with the adjacent `compatibility.patch`. The patch adds `export type * from`
and `export type * as name from` alternatives to the shared grammar. Star exports
require a source clause; existing named type exports are unchanged. The patch also
moves the existing import-type alternatives into primary types, allowing their
use as array elements and indexed types, including inside generic arguments. Argus parses
the original source without masking text or suppressing errors.

The inherited JavaScript grammar is the exact npm package
`tree-sitter-javascript@0.23.1` (integrity
`sha512-/bnhbrTD9frUYHQTiYnPcxyHORIw157ERBa6dqzaKxvR/x3PC4Yzd+D1pZIMS6zNg2v3a8BZ0oK7jHqsQo9fWA==`).

Build tools: Tree-sitter CLI **0.27.0**, WASI SDK **29.0**, Binaryen **132**, Bun
**1.4.2**, macOS arm64. Both grammars use ABI **15** and are loaded and exercised
by Argus's pinned `web-tree-sitter@0.27.0`. Normal builds embed these files and
need neither a compiler nor network access.

| Asset | SHA-256 |
| --- | --- |
| `tree-sitter-typescript.wasm` | `e34dc6ef250b1889ecba1bb800256a8b86d1f13ecd9f1e872e9f94b8d1c247df` |
| `tree-sitter-tsx.wasm` | `b52ed0b9b066bd90034741b838f72ccf24dde8d51b0c8b1587bf4f85f4e32234` |
| `tree-sitter-macos-arm64.gz` | `70f7573b2b2e5371a5b58cc5227d2ad981fd5374596b9874e770af486060774e` |
| `wasi-sdk-29.0-arm64-macos.tar.gz` | `e11552913e3f99e834d7fe7da1bd081abaf764759ed76b6097a34c63fc83665e` |
| `binaryen-version_132-arm64-macos.tar.gz` | `98aad827847af7ef990ed7098d885725c8e5b5aae75073403635617ae4e259aa` |

## Rebuild

Run from the monorepo root in a fresh task directory. Download the CLI and WASI
SDK from their pinned official releases, verify the archive checksums above,
and extract them as `tree-sitter` and `wasi-sdk-29.0-arm64-macos` under
`$ARGUS_GRAMMAR_WORK`. Give the CLI executable permission. Tree-sitter downloads
its pinned Binaryen **132** into the explicitly selected project cache on first
build; retain and verify that archive against the checksum above.

```sh
ARGUS_GRAMMAR_DIR="$PWD/packages/argus/src/languages/typescript/grammar"
ARGUS_GRAMMAR_WORK="$PWD/.claude/argus-typescript-grammar"
mkdir -p "$ARGUS_GRAMMAR_WORK"
export XDG_CACHE_HOME="$ARGUS_GRAMMAR_WORK/cache"
export TREE_SITTER_WASI_SDK_PATH="$ARGUS_GRAMMAR_WORK/wasi-sdk-29.0-arm64-macos"
cd "$ARGUS_GRAMMAR_WORK"
bun -e 'await Bun.write("package.json", JSON.stringify({private:true,dependencies:{"tree-sitter-javascript":"0.23.1"}}))'
bun install --ignore-scripts
git clone https://github.com/tree-sitter/tree-sitter-typescript.git source
cd source
git switch --detach f975a621f4e7f532fe322e13c4f79495e0a7b2e7
git apply "$ARGUS_GRAMMAR_DIR/compatibility.patch"
cd typescript
"$ARGUS_GRAMMAR_WORK/tree-sitter" generate --abi 15 --js-runtime bun
"$ARGUS_GRAMMAR_WORK/tree-sitter" build --wasm -o "$ARGUS_GRAMMAR_DIR/tree-sitter-typescript.wasm"
cd ../tsx
"$ARGUS_GRAMMAR_WORK/tree-sitter" generate --abi 15 --js-runtime bun
"$ARGUS_GRAMMAR_WORK/tree-sitter" build --wasm -o "$ARGUS_GRAMMAR_DIR/tree-sitter-tsx.wasm"
shasum -a 256 "$ARGUS_GRAMMAR_DIR"/*.wasm
```

The native Node bindings and their install scripts are unused; grammar generation
loads only the pinned JavaScript grammar source through Bun. Return to the
monorepo root and run `bun test packages/argus/tests/languages`,
`bun --filter @r5n/argus type-check`, and `bun --filter @r5n/argus build`.
TypeScript regressions cover both dialects, preserved source and locations,
contract evidence through plain and namespace re-exports, and rejected malformed
exports and import types composed with arrays/indexed access. The upstream
grammar corpus also passes all 112 cases. Review any checksum change before replacing the assets.

These grammars are MIT-licensed; attribution is reproduced in
[THIRD_PARTY_NOTICES.md](../../../../THIRD_PARTY_NOTICES.md).
