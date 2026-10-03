import { grammarBytes, TreeSitterParser } from "../../syntax/TreeSitterParser";

declare const ARGUS_TYPESCRIPT_WASM: string | undefined;
declare const ARGUS_TSX_WASM: string | undefined;

const typescript = TreeSitterParser.load({
  label: "TypeScript",
  bytes: grammarBytes(
    new URL("./grammar/tree-sitter-typescript.wasm", import.meta.url).href,
    typeof ARGUS_TYPESCRIPT_WASM === "string" ? ARGUS_TYPESCRIPT_WASM : undefined,
  ),
});
const tsx = TreeSitterParser.load({
  label: "TSX",
  bytes: grammarBytes(
    new URL("./grammar/tree-sitter-tsx.wasm", import.meta.url).href,
    typeof ARGUS_TSX_WASM === "string" ? ARGUS_TSX_WASM : undefined,
  ),
});

export function typescriptParser(path: string): Promise<TreeSitterParser> {
  return path.endsWith(".tsx") ? tsx : typescript;
}
