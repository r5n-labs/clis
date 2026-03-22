import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FileNode } from "../../src/services/CodebaseScanner";
import {
  analyzeImports,
  extractImports,
  flattenFileTree,
} from "../../src/services/ImportAnalyzer";

// ── flattenFileTree ──────────────────────────────────────────────────

describe("flattenFileTree", () => {
  test("returns path for a single file node", () => {
    const node: FileNode = { name: "index.ts", type: "file", path: "src/index.ts" };
    expect(flattenFileTree(node)).toEqual(["src/index.ts"]);
  });

  test("flattens nested tree into file paths only", () => {
    const tree: FileNode = {
      name: ".",
      type: "directory",
      path: ".",
      children: [
        {
          name: "src",
          type: "directory",
          path: "src",
          children: [
            { name: "index.ts", type: "file", path: "src/index.ts" },
            { name: "utils.ts", type: "file", path: "src/utils.ts" },
          ],
        },
        { name: "README.md", type: "file", path: "README.md" },
      ],
    };
    const result = flattenFileTree(tree);
    expect(result).toEqual(["src/index.ts", "src/utils.ts", "README.md"]);
  });

  test("returns empty array for empty directory", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty", children: [] };
    expect(flattenFileTree(node)).toEqual([]);
  });

  test("handles directory with no children property", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty" };
    expect(flattenFileTree(node)).toEqual([]);
  });

  test("does not include directory paths in output", () => {
    const tree: FileNode = {
      name: ".",
      type: "directory",
      path: ".",
      children: [
        {
          name: "lib",
          type: "directory",
          path: "lib",
          children: [
            { name: "mod.ts", type: "file", path: "lib/mod.ts" },
          ],
        },
      ],
    };
    const result = flattenFileTree(tree);
    expect(result).toEqual(["lib/mod.ts"]);
    expect(result).not.toContain(".");
    expect(result).not.toContain("lib");
  });
});

// ── extractImports ───────────────────────────────────────────────────

describe("extractImports", () => {
  test("extracts named static imports", () => {
    const source = `import { foo, bar } from "my-lib";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("my-lib");
    expect(result[0]!.specifiers).toContain("foo");
    expect(result[0]!.specifiers).toContain("bar");
  });

  test("extracts default imports", () => {
    const source = `import React from "react";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("react");
    expect(result[0]!.specifiers).toContain("React");
  });

  test("extracts default + named imports", () => {
    const source = `import React, { useState, useEffect } from "react";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("react");
    expect(result[0]!.specifiers).toContain("React");
    expect(result[0]!.specifiers).toContain("useState");
    expect(result[0]!.specifiers).toContain("useEffect");
  });

  test("extracts side-effect imports", () => {
    const source = `import "reflect-metadata";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("reflect-metadata");
    expect(result[0]!.specifiers).toEqual([]);
  });

  test("extracts dynamic imports", () => {
    const source = `const mod = await import("./lazy-module");`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("./lazy-module");
    expect(result[0]!.specifiers).toEqual([]);
  });

  test("extracts require calls", () => {
    const source = `const fs = require("node:fs");`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("node:fs");
  });

  test("extracts named re-exports", () => {
    const source = `export { foo, bar } from "./utils";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("./utils");
    expect(result[0]!.specifiers).toContain("foo");
    expect(result[0]!.specifiers).toContain("bar");
  });

  test("extracts star re-exports", () => {
    const source = `export * from "./types";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("./types");
    expect(result[0]!.specifiers).toEqual(["*"]);
  });

  test("extracts type imports", () => {
    const source = `import type { MyType } from "./types";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("./types");
    expect(result[0]!.specifiers).toContain("MyType");
  });

  test("strips block comments before parsing", () => {
    const source = [
      `/* import { fake } from "not-real"; */`,
      `import { real } from "actual-module";`,
    ].join("\n");
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("actual-module");
  });

  test("skips single-line comment imports", () => {
    const source = [
      `// import { fake } from "not-real";`,
      `import { real } from "actual-module";`,
    ].join("\n");
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("actual-module");
  });

  test("handles multiple imports in one file", () => {
    const source = [
      `import { a } from "pkg-a";`,
      `import b from "pkg-b";`,
      `const c = require("pkg-c");`,
      `export { d } from "pkg-d";`,
    ].join("\n");
    const result = extractImports(source);
    expect(result).toHaveLength(4);
    const modules = result.map((r) => r.modulePath);
    expect(modules).toContain("pkg-a");
    expect(modules).toContain("pkg-b");
    expect(modules).toContain("pkg-c");
    expect(modules).toContain("pkg-d");
  });

  test("returns empty array for source with no imports", () => {
    const source = `const x = 42;\nconsole.log(x);`;
    const result = extractImports(source);
    expect(result).toHaveLength(0);
  });

  test("handles aliased imports (as keyword)", () => {
    const source = `import { foo as bar } from "my-lib";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    // Should capture the original name "foo", not the alias "bar"
    expect(result[0]!.specifiers).toContain("foo");
  });

  test("handles scoped package imports", () => {
    const source = `import { something } from "@scope/package";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("@scope/package");
  });

  test("extracts type re-exports", () => {
    const source = `export type { MyType } from "./types";`;
    const result = extractImports(source);
    expect(result).toHaveLength(1);
    expect(result[0]!.modulePath).toBe("./types");
  });
});

// ── analyzeImports (filesystem integration) ──────────────────────────

describe("analyzeImports", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "atlas-imports-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("classifies relative imports as internal", async () => {
    await mkdir(join(tmpDir, "src"));
    await writeFile(
      join(tmpDir, "src", "index.ts"),
      `import { helper } from "./utils";\n`,
    );
    await writeFile(join(tmpDir, "src", "utils.ts"), `export const helper = 1;\n`);
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg" }),
    );

    const result = await analyzeImports({
      root: tmpDir,
      files: ["src/index.ts", "src/utils.ts"],
      ignore: [],
    });

    const internal = result.imports.filter((i) => i.type === "internal");
    expect(internal.length).toBeGreaterThan(0);
    expect(internal[0]!.source).toBe("src/index.ts");
  });

  test("classifies node_modules imports as external", async () => {
    await writeFile(
      join(tmpDir, "index.ts"),
      `import { readFile } from "node:fs";\nimport express from "express";\n`,
    );
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg" }),
    );

    const result = await analyzeImports({
      root: tmpDir,
      files: ["index.ts"],
      ignore: [],
    });

    const external = result.imports.filter((i) => i.type === "external");
    expect(external.length).toBe(2);
    const targets = external.map((e) => e.target);
    expect(targets).toContain("node:fs");
    expect(targets).toContain("express");
  });

  test("classifies workspace package imports as package", async () => {
    await mkdir(join(tmpDir, "packages", "core"), { recursive: true });
    await mkdir(join(tmpDir, "packages", "app"), { recursive: true });
    await writeFile(
      join(tmpDir, "packages", "core", "package.json"),
      JSON.stringify({ name: "@test/core" }),
    );
    await writeFile(
      join(tmpDir, "packages", "app", "package.json"),
      JSON.stringify({ name: "@test/app" }),
    );
    await writeFile(
      join(tmpDir, "packages", "app", "index.ts"),
      `import { something } from "@test/core";\n`,
    );

    const result = await analyzeImports({
      root: tmpDir,
      files: ["packages/app/index.ts"],
      ignore: [],
    });

    const pkgImports = result.imports.filter((i) => i.type === "package");
    expect(pkgImports.length).toBe(1);
    expect(pkgImports[0]!.target).toBe("@test/core");
  });

  test("resolves relative imports with extension", async () => {
    await mkdir(join(tmpDir, "src"));
    await writeFile(
      join(tmpDir, "src", "index.ts"),
      `import { x } from "./helper.ts";\n`,
    );
    await writeFile(join(tmpDir, "src", "helper.ts"), `export const x = 1;\n`);
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg" }),
    );

    const result = await analyzeImports({
      root: tmpDir,
      files: ["src/index.ts", "src/helper.ts"],
      ignore: [],
    });

    const internal = result.imports.filter((i) => i.type === "internal");
    expect(internal.length).toBe(1);
    expect(internal[0]!.target).toBe("src/helper.ts");
  });

  test("resolves relative imports without extension", async () => {
    await mkdir(join(tmpDir, "src"));
    await writeFile(
      join(tmpDir, "src", "index.ts"),
      `import { x } from "./helper";\n`,
    );
    await writeFile(join(tmpDir, "src", "helper.ts"), `export const x = 1;\n`);
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg" }),
    );

    const result = await analyzeImports({
      root: tmpDir,
      files: ["src/index.ts", "src/helper.ts"],
      ignore: [],
    });

    const internal = result.imports.filter((i) => i.type === "internal");
    expect(internal.length).toBe(1);
    expect(internal[0]!.target).toBe("src/helper.ts");
  });

  test("resolves directory index imports", async () => {
    await mkdir(join(tmpDir, "src"));
    await mkdir(join(tmpDir, "src", "utils"));
    await writeFile(
      join(tmpDir, "src", "index.ts"),
      `import { x } from "./utils";\n`,
    );
    await writeFile(join(tmpDir, "src", "utils", "index.ts"), `export const x = 1;\n`);
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg" }),
    );

    const result = await analyzeImports({
      root: tmpDir,
      files: ["src/index.ts", "src/utils/index.ts"],
      ignore: [],
    });

    const internal = result.imports.filter((i) => i.type === "internal");
    expect(internal.length).toBe(1);
    expect(internal[0]!.target).toBe("src/utils/index.ts");
  });

  test("builds fileToPackage mapping", async () => {
    await mkdir(join(tmpDir, "src"));
    await writeFile(join(tmpDir, "src", "index.ts"), `export const x = 1;\n`);
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-pkg" }),
    );

    const result = await analyzeImports({
      root: tmpDir,
      files: ["src/index.ts"],
      ignore: [],
    });

    expect(result.fileToPackage["src/index.ts"]).toBe("my-pkg");
  });

  test("only analyzes files with known extensions", async () => {
    await writeFile(join(tmpDir, "data.json"), `{}`);
    await writeFile(join(tmpDir, "style.css"), `body {}`);
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg" }),
    );

    const result = await analyzeImports({
      root: tmpDir,
      files: ["data.json", "style.css"],
      ignore: [],
    });

    expect(result.imports).toHaveLength(0);
  });
});
