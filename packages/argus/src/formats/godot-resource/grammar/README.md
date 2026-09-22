# Godot resource grammar

`tree-sitter-godot_resource.wasm` is built from
[`tree-sitter-godot-resource` revision `302c1895f54bf74d53a08572f7b26a6614209adc`](https://github.com/PrestonKnopp/tree-sitter-godot-resource/tree/302c1895f54bf74d53a08572f7b26a6614209adc),
with the adjacent `compatibility.patch`. Upstream supplies StringName syntax; the patch adds trailing commas in arrays and dictionaries, and dotted property paths for project-setting feature overrides. No source-text rewriting or error suppression is involved.

The published `0.7.0` grammar used by `tree-sitter-wasm@1.1.2` predates StringName support. Keep this asset until a published WASM dependency passes the resource regression tests with these forms. Normal Argus builds embed this file and require no compiler or network access.

Build tools: Tree-sitter CLI **0.25.10**, Emscripten **4.0.15**, Bun **1.3.10**; language ABI **15**. The build was produced on macOS arm64. The resulting WASM is platform independent.

SHA-256: `c914e06a48077982f50c7034caf30fdb93315b556698e3e0dc37a0d7075f0d86`.

## Rebuild

Install the pinned Tree-sitter CLI and activate Emscripten 4.0.15 in the current shell. From the monorepo root, use a fresh temporary checkout:

```sh
ARGUS_GRAMMAR_DIR="$PWD/packages/argus/src/formats/godot-resource/grammar"
ARGUS_GRAMMAR_WORK=$(mktemp -d "$HOME/Desktop/Dev/tmp/argus-grammar.XXXXXX")
git clone https://github.com/PrestonKnopp/tree-sitter-godot-resource.git "$ARGUS_GRAMMAR_WORK/source"
cd "$ARGUS_GRAMMAR_WORK/source"
git switch --detach 302c1895f54bf74d53a08572f7b26a6614209adc
git apply "$ARGUS_GRAMMAR_DIR/compatibility.patch"
tree-sitter generate --abi 15 --js-runtime bun
tree-sitter build --wasm -o "$ARGUS_GRAMMAR_DIR/tree-sitter-godot_resource.wasm"
shasum -a 256 "$ARGUS_GRAMMAR_DIR/tree-sitter-godot_resource.wasm"
```

After rebuilding, return to the monorepo root and run `bun test packages/argus/tests`, `bun --filter @r5n/argus type-check`, and `bun --filter @r5n/argus build`. Review any checksum change and update the revision, tool versions and checksum here when intentionally replacing the asset.

The grammar is MIT-licensed; its licence is reproduced in [THIRD_PARTY_NOTICES.md](../../../../THIRD_PARTY_NOTICES.md).
