import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const SOURCE = resolve(import.meta.dir, "../../src");
const IMPORTS = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/g;
const IMPLEMENTATIONS = new Set(["languages", "formats", "frameworks", "reviews"]);
const ADAPTER_DEPENDENCIES = new Set(["analysis", "domain", "syntax", "constants.ts"]);

function dependencies(source: string): string[] {
  return [...source.matchAll(IMPORTS)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function allowed(from: string, to: string): boolean {
  const [layer, owner] = from.split("/");
  const [dependency, dependencyOwner] = to.split("/");
  if (!layer || !dependency) return false;
  if (layer === "composition") return true;
  if (dependency === "composition")
    return layer === "commands" || (from === "config/validation.ts" && to === "composition/scan-profile.ts");
  if (!IMPLEMENTATIONS.has(layer)) return !IMPLEMENTATIONS.has(dependency);
  if (ADAPTER_DEPENDENCIES.has(dependency)) return true;
  if (layer === dependency && owner === dependencyOwner) return true;
  if (layer === "frameworks")
    return (
      dependency === "formats" || to === "languages/gdscript/runtime.ts" || to === "languages/typescript/testing.ts"
    );
  if (layer === "reviews" && to === "storage/fingerprints.ts") return true;
  return false;
}

test("analysis implementations cannot leak into the pipeline or cross adapter boundaries", () => {
  const violations: string[] = [];
  for (const path of new Bun.Glob("**/*.{ts,tsx}").scanSync(SOURCE)) {
    const source = readFileSync(resolve(SOURCE, path), "utf8");
    for (const dependency of dependencies(source)) {
      if (!dependency.startsWith(".")) continue;
      let destination = relative(SOURCE, resolve(SOURCE, dirname(path), dependency));
      if (!/\.(ts|tsx|json|css)$/.test(destination)) destination += ".ts";
      if (!allowed(path, destination)) violations.push(`${path} -> ${destination}`);
    }
  }
  expect(violations).toEqual([]);
});

test("boundary rules inspect type imports, re-exports and dynamic imports", () => {
  expect(
    dependencies(`import type { Thing } from "../languages/example/model";
export * from "../formats/example/parser";
const parser = import("../languages/example/parser");
const other = require("../frameworks/example/runtime");`),
  ).toEqual([
    "../languages/example/model",
    "../formats/example/parser",
    "../languages/example/parser",
    "../frameworks/example/runtime",
  ]);
  expect(allowed("services/ProjectScanner.ts", "languages/example/Adapter.ts")).toBe(false);
  expect(allowed("syntax/TreeSitterParser.ts", "languages/example/Adapter.ts")).toBe(false);
  expect(allowed("languages/example/Adapter.ts", "syntax/TreeSitterParser.ts")).toBe(true);
  expect(allowed("contexts/ContextBuilder.ts", "composition/analysis.ts")).toBe(false);
  expect(allowed("formats/example/Adapter.ts", "languages/example/Parser.ts")).toBe(false);
  expect(allowed("languages/python/Adapter.ts", "languages/gdscript/parser.ts")).toBe(false);
  expect(allowed("reviews/translations/Evidence.ts", "formats/gettext/parser.ts")).toBe(false);
  expect(allowed("frameworks/godot/Runtime.ts", "languages/gdscript/GDScriptAdapter.ts")).toBe(false);
  expect(allowed("frameworks/test-runners/TestRunnerConvention.ts", "languages/typescript/testing.ts")).toBe(true);
  expect(
    allowed("frameworks/test-runners/TestRunnerConvention.ts", "languages/typescript/TypeScriptExtractor.ts"),
  ).toBe(false);
  expect(
    allowed("languages/typescript/TypeScriptExtractor.ts", "frameworks/test-runners/TestRunnerConvention.ts"),
  ).toBe(false);
});

test("shared analysis contains no framework paths, source suffixes or gettext syntax", () => {
  const violations: string[] = [];
  const specificSyntax = /res:\/\/|project\.godot|\.(?:gd|tscn|tres|po)\b|\bmsgid\b|startsWith\(["']test_/;
  for (const path of new Bun.Glob("{analysis,contexts,domain,services,storage,syntax}/**/*.ts").scanSync(SOURCE))
    if (specificSyntax.test(readFileSync(resolve(SOURCE, path), "utf8"))) violations.push(path);
  expect(violations).toEqual([]);
});
