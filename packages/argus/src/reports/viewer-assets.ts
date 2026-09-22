import { fileURLToPath } from "node:url";

declare const ARGUS_REPORT_SCRIPT: string | undefined;
declare const ARGUS_REPORT_STYLE: string | undefined;
export type ViewerAssets = { script: string; style: string };
let developmentAssets: Promise<ViewerAssets> | undefined;

export async function buildViewerAssets(): Promise<ViewerAssets> {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(import.meta.resolve("./ui/main.tsx"))],
    target: "browser",
    format: "iife",
    minify: true,
    packages: "bundle",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) throw new Error(`Cannot build Argus report viewer: ${result.logs.join("\n")}`);
  const output = result.outputs.find((item) => item.kind === "entry-point");
  if (!output) throw new Error("Report viewer build produced no JavaScript");
  return {
    script: await output.text(),
    style: await Bun.file(fileURLToPath(import.meta.resolve("./ui/styles.css"))).text(),
  };
}

export async function viewerAssets(): Promise<ViewerAssets> {
  if (typeof ARGUS_REPORT_SCRIPT === "string" && typeof ARGUS_REPORT_STYLE === "string")
    return { script: ARGUS_REPORT_SCRIPT, style: ARGUS_REPORT_STYLE };
  developmentAssets ??= buildViewerAssets();
  return developmentAssets;
}
