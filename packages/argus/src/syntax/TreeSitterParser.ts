import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Exit } from "@r5n/cli-core";
import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import { ONE_BASED_LINE } from "../constants";

declare const ARGUS_RUNTIME_WASM: string | undefined;

let runtime: Promise<void> | undefined;

export function grammarBytes(specifier: string, embedded?: string): Uint8Array {
  return embedded ? Buffer.from(embedded, "base64") : readFileSync(fileURLToPath(import.meta.resolve(specifier)));
}

export class TreeSitterParser {
  private constructor(
    private readonly language: Language,
    private readonly label: string,
  ) {}

  static async load(options: { bytes: Uint8Array; label: string }): Promise<TreeSitterParser> {
    runtime ??= Parser.init({
      wasmBinary: grammarBytes(
        "web-tree-sitter/web-tree-sitter.wasm",
        typeof ARGUS_RUNTIME_WASM === "string" ? ARGUS_RUNTIME_WASM : undefined,
      ),
    });
    await runtime;
    return new TreeSitterParser(await Language.load(options.bytes), options.label);
  }

  read<T>(path: string, source: string, extract: (root: Node) => T): T {
    const parser = new Parser().setLanguage(this.language);
    let tree: Tree | null = null;
    try {
      tree = parser.parse(source);
      if (!tree) throw new Exit(`Cannot parse ${path}`);
      if (tree.rootNode.hasError) {
        const error = tree.rootNode.descendantsOfType("ERROR")[0];
        throw new Exit(
          `${this.label} syntax not understood: ${path}:${(error?.startPosition.row ?? 0) + ONE_BASED_LINE}`,
          "Fix the syntax or exclude this file; Argus will not silently omit evidence",
        );
      }
      return extract(tree.rootNode);
    } finally {
      tree?.delete();
      parser.delete();
    }
  }
}
