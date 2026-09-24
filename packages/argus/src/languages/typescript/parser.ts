import { grammarBytes, TreeSitterParser } from "../../syntax/TreeSitterParser";

declare const ARGUS_TYPESCRIPT_WASM: string | undefined;
declare const ARGUS_TSX_WASM: string | undefined;

const typescript = TreeSitterParser.load({
  label: "TypeScript",
  bytes: grammarBytes(
    "tree-sitter-wasm/typescript/tree-sitter-typescript.wasm",
    typeof ARGUS_TYPESCRIPT_WASM === "string" ? ARGUS_TYPESCRIPT_WASM : undefined,
  ),
});
const tsx = TreeSitterParser.load({
  label: "TSX",
  bytes: grammarBytes(
    "tree-sitter-wasm/tsx/tree-sitter-tsx.wasm",
    typeof ARGUS_TSX_WASM === "string" ? ARGUS_TSX_WASM : undefined,
  ),
});

export function typescriptParser(path: string): Promise<TreeSitterParser> {
  return path.endsWith(".tsx") ? tsx : typescript;
}
