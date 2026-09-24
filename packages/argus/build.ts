import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bunPackageBuilder } from "@r5n/tools/builder";
import { buildViewerAssets } from "./src/reports/viewer-assets";

const MAX_BUNDLE_KB = 5800;
const encodedWasm = (specifier: string) =>
  JSON.stringify(readFileSync(fileURLToPath(import.meta.resolve(specifier))).toString("base64"));

const viewer = await buildViewerAssets();

await bunPackageBuilder({
  banner: "#!/usr/bin/env bun",
  define: {
    ARGUS_REPORT_SCRIPT: JSON.stringify(viewer.script),
    ARGUS_REPORT_STYLE: JSON.stringify(viewer.style),
    ARGUS_RUNTIME_WASM: encodedWasm("web-tree-sitter/web-tree-sitter.wasm"),
    ARGUS_GODOT_RESOURCE_WASM: encodedWasm("./src/formats/godot-resource/grammar/tree-sitter-godot_resource.wasm"),
    ARGUS_GDSCRIPT_WASM: encodedWasm("tree-sitter-wasm/gdscript/tree-sitter-gdscript.wasm"),
    ARGUS_TYPESCRIPT_WASM: encodedWasm("tree-sitter-wasm/typescript/tree-sitter-typescript.wasm"),
    ARGUS_TSX_WASM: encodedWasm("tree-sitter-wasm/tsx/tree-sitter-tsx.wasm"),
  },
  entrypoints: ["./src/cli.ts"],
  maxSize: MAX_BUNDLE_KB,
  packages: "bundle",
  target: "bun",
  type: "cli",
});
