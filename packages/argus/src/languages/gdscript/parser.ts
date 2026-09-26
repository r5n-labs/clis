import { grammarBytes, TreeSitterParser } from "../../syntax/TreeSitterParser";

declare const ARGUS_GDSCRIPT_WASM: string | undefined;

export const gdscriptParser = await TreeSitterParser.load({
  label: "GDScript",
  bytes: grammarBytes(
    "tree-sitter-wasm/gdscript/tree-sitter-gdscript.wasm",
    typeof ARGUS_GDSCRIPT_WASM === "string" ? ARGUS_GDSCRIPT_WASM : undefined,
  ),
});
