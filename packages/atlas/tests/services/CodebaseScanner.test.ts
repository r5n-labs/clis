import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type FileNode,
  collectExtensions,
  countNodes,
  globToRegex,
  parseGitignore,
  scan,
  shouldIgnore,
} from "../../src/services/CodebaseScanner";

// ── globToRegex ──────────────────────────────────────────────────────

describe("globToRegex", () => {
  test("simple name matches at any depth when unanchored", () => {
    const re = globToRegex("node_modules", false);
    expect(re.test("node_modules")).toBe(true);
    expect(re.test("foo/node_modules")).toBe(true);
    expect(re.test("foo/bar/node_modules")).toBe(true);
  });

  test("simple name does not match partial segments", () => {
    const re = globToRegex("node_modules", false);
    expect(re.test("my_node_modules")).toBe(false);
    expect(re.test("node_modules_extra")).toBe(false);
  });

  test("* matches anything except /", () => {
    const re = globToRegex("*.log", false);
    expect(re.test("debug.log")).toBe(true);
    expect(re.test("error.log")).toBe(true);
    expect(re.test("nested/error.log")).toBe(true);
    expect(re.test("debug.txt")).toBe(false);
  });

  test("** matches directory prefixes for nested paths", () => {
    // logs/** generates an anchored regex since it contains a slash
    // The pattern matches paths that start with logs/ (used as ignore prefix)
    const re = globToRegex("logs/**", false);
    expect(re.test("logs/")).toBe(true);
    expect(re.test("logs/nested/")).toBe(true);
  });

  test("**/pattern matches at any depth", () => {
    const re = globToRegex("**/temp", false);
    expect(re.test("temp")).toBe(true);
    expect(re.test("src/temp")).toBe(true);
    expect(re.test("src/deep/temp")).toBe(true);
  });

  test("? matches a single non-slash character", () => {
    const re = globToRegex("file?.txt", false);
    expect(re.test("file1.txt")).toBe(true);
    expect(re.test("fileA.txt")).toBe(true);
    expect(re.test("file12.txt")).toBe(false);
  });

  test("anchored pattern matches from start only", () => {
    const re = globToRegex("src", true);
    expect(re.test("src")).toBe(true);
    expect(re.test("src/file.ts")).toBe(true);
    expect(re.test("lib/src")).toBe(false);
  });

  test("pattern with slash is anchored automatically", () => {
    const re = globToRegex("src/temp", false);
    expect(re.test("src/temp")).toBe(true);
    expect(re.test("src/temp/file.ts")).toBe(true);
  });

  test("escapes regex special characters in literal parts", () => {
    const re = globToRegex("file.txt", false);
    expect(re.test("file.txt")).toBe(true);
    expect(re.test("fileTtxt")).toBe(false);
  });
});

// ── parseGitignore ───────────────────────────────────────────────────

describe("parseGitignore", () => {
  test("skips empty lines", () => {
    const result = parseGitignore("\n\n\n", "");
    expect(result).toHaveLength(0);
  });

  test("skips comment lines", () => {
    const result = parseGitignore("# this is a comment\n# another", "");
    expect(result).toHaveLength(0);
  });

  test("parses basic patterns", () => {
    const result = parseGitignore("node_modules\ndist", "");
    expect(result).toHaveLength(2);
    expect(result[0]!.pattern).toBe("node_modules");
    expect(result[1]!.pattern).toBe("dist");
  });

  test("handles negation patterns", () => {
    const result = parseGitignore("*.log\n!important.log", "");
    expect(result).toHaveLength(2);
    expect(result[0]!.negated).toBe(false);
    expect(result[1]!.negated).toBe(true);
    expect(result[1]!.pattern).toBe("important.log");
  });

  test("handles directory-only patterns (trailing /)", () => {
    const result = parseGitignore("build/", "");
    expect(result).toHaveLength(1);
    expect(result[0]!.directoryOnly).toBe(true);
    expect(result[0]!.pattern).toBe("build");
  });

  test("handles anchored patterns (leading /)", () => {
    const result = parseGitignore("/src", "");
    expect(result).toHaveLength(1);
    // Leading slash is stripped, but the pattern is anchored via the regex
    expect(result[0]!.pattern).toBe("src");
  });

  test("prepends basePath for nested gitignore files", () => {
    const result = parseGitignore("temp", "packages/app");
    expect(result).toHaveLength(1);
    expect(result[0]!.pattern).toBe("packages/app/temp");
  });

  test("handles mixed content (comments, empty lines, patterns)", () => {
    const content = [
      "# Build output",
      "dist/",
      "",
      "# Logs",
      "*.log",
      "!important.log",
      "",
      "/local-only",
    ].join("\n");
    const result = parseGitignore(content, "");
    expect(result).toHaveLength(4);
    expect(result[0]!.directoryOnly).toBe(true);
    expect(result[2]!.negated).toBe(true);
  });
});

// ── shouldIgnore ─────────────────────────────────────────────────────

describe("shouldIgnore", () => {
  test("matches a simple pattern", () => {
    const patterns = parseGitignore("node_modules", "");
    expect(shouldIgnore("node_modules", patterns, true)).toBe(true);
    expect(shouldIgnore("src/node_modules", patterns, true)).toBe(true);
  });

  test("glob pattern matches files", () => {
    const patterns = parseGitignore("*.log", "");
    expect(shouldIgnore("debug.log", patterns, false)).toBe(true);
    expect(shouldIgnore("error.log", patterns, false)).toBe(true);
    expect(shouldIgnore("debug.txt", patterns, false)).toBe(false);
  });

  test("directory-only pattern does not match files", () => {
    const patterns = parseGitignore("build/", "");
    expect(shouldIgnore("build", patterns, true)).toBe(true);
    expect(shouldIgnore("build", patterns, false)).toBe(false);
  });

  test("negation un-ignores previously matched patterns", () => {
    const patterns = parseGitignore("*.log\n!important.log", "");
    expect(shouldIgnore("debug.log", patterns, false)).toBe(true);
    expect(shouldIgnore("important.log", patterns, false)).toBe(false);
  });

  test("returns false when no patterns match", () => {
    const patterns = parseGitignore("*.log", "");
    expect(shouldIgnore("index.ts", patterns, false)).toBe(false);
  });

  test("last matching pattern wins", () => {
    const patterns = parseGitignore("*.log\n!*.log\n*.log", "");
    expect(shouldIgnore("test.log", patterns, false)).toBe(true);
  });
});

// ── countNodes ────────────────────────────────────────────────────────

describe("countNodes", () => {
  test("single file returns 1 file, 0 directories", () => {
    const node: FileNode = { name: "index.ts", type: "file", path: "index.ts" };
    expect(countNodes(node)).toEqual({ files: 1, directories: 0 });
  });

  test("empty directory returns 0 files, 1 directory", () => {
    const node: FileNode = { name: "src", type: "directory", path: "src", children: [] };
    expect(countNodes(node)).toEqual({ files: 0, directories: 1 });
  });

  test("counts nested tree correctly", () => {
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
    const result = countNodes(tree);
    expect(result.files).toBe(3);
    expect(result.directories).toBe(2); // root "." + "src"
  });

  test("directory with no children property treated as empty", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty" };
    expect(countNodes(node)).toEqual({ files: 0, directories: 1 });
  });
});

// ── collectExtensions ────────────────────────────────────────────────

describe("collectExtensions", () => {
  test("single file returns its extension", () => {
    const node: FileNode = { name: "app.ts", type: "file", path: "app.ts", extension: ".ts" };
    expect(collectExtensions(node)).toEqual({ ".ts": 1 });
  });

  test("file without extension returns empty record", () => {
    const node: FileNode = { name: "Makefile", type: "file", path: "Makefile" };
    expect(collectExtensions(node)).toEqual({});
  });

  test("counts extensions across nested tree", () => {
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
            { name: "index.ts", type: "file", path: "src/index.ts", extension: ".ts" },
            { name: "styles.css", type: "file", path: "src/styles.css", extension: ".css" },
            { name: "utils.ts", type: "file", path: "src/utils.ts", extension: ".ts" },
          ],
        },
        { name: "config.json", type: "file", path: "config.json", extension: ".json" },
      ],
    };
    const result = collectExtensions(tree);
    expect(result).toEqual({ ".ts": 2, ".css": 1, ".json": 1 });
  });

  test("empty directory returns empty record", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty", children: [] };
    expect(collectExtensions(node)).toEqual({});
  });
});

// ── scan (filesystem integration) ────────────────────────────────────

describe("scan", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "atlas-scanner-"));
    // Build a test directory structure:
    //   tmpDir/
    //     src/
    //       index.ts
    //       utils.ts
    //     dist/
    //       bundle.js
    //     .gitignore
    //     README.md
    await mkdir(join(tmpDir, "src"));
    await mkdir(join(tmpDir, "dist"));
    await writeFile(join(tmpDir, "src", "index.ts"), 'export const x = 1;');
    await writeFile(join(tmpDir, "src", "utils.ts"), 'export const y = 2;');
    await writeFile(join(tmpDir, "dist", "bundle.js"), 'var x=1;');
    await writeFile(join(tmpDir, "README.md"), "# Test");
    await writeFile(join(tmpDir, ".gitignore"), "dist\n");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns correct file tree structure", async () => {
    const result = await scan({
      root: tmpDir,
      ignore: [],
      maxDepth: 10,
      includeStats: false,
      respectGitignore: false,
    });

    expect(result.root).toBe(tmpDir);
    expect(result.tree.type).toBe("directory");
    expect(result.tree.name).toBe(".");
    expect(result.totalFiles).toBeGreaterThan(0);
    expect(typeof result.generatedAt).toBe("string");
  });

  test("respects ignore patterns from config", async () => {
    const result = await scan({
      root: tmpDir,
      ignore: ["dist"],
      maxDepth: 10,
      includeStats: false,
      respectGitignore: false,
    });

    const allNames = flattenNames(result.tree);
    expect(allNames).not.toContain("dist");
    expect(allNames).toContain("src");
  });

  test("respects .gitignore when enabled", async () => {
    const result = await scan({
      root: tmpDir,
      ignore: [],
      maxDepth: 10,
      includeStats: false,
      respectGitignore: true,
    });

    const allNames = flattenNames(result.tree);
    expect(allNames).not.toContain("dist");
    expect(allNames).toContain("src");
  });

  test("respects maxDepth", async () => {
    const result = await scan({
      root: tmpDir,
      ignore: [],
      maxDepth: 1,
      includeStats: false,
      respectGitignore: false,
    });

    // Depth 1 means root can read its children but subdirectories are empty
    const srcNode = result.tree.children?.find((c) => c.name === "src");
    expect(srcNode).toBeDefined();
    expect(srcNode!.children).toEqual([]);
  });

  test("includeStats populates size and extension fields", async () => {
    const result = await scan({
      root: tmpDir,
      ignore: [],
      maxDepth: 10,
      includeStats: true,
      respectGitignore: false,
    });

    expect(result.extensions).toBeDefined();
    expect(result.extensions![".ts"]).toBe(2);

    // Check that file nodes have size
    const srcNode = result.tree.children?.find((c) => c.name === "src");
    const indexFile = srcNode?.children?.find((c) => c.name === "index.ts");
    expect(indexFile?.size).toBeGreaterThan(0);
  });

  test("extensions are not populated when includeStats is false", async () => {
    const result = await scan({
      root: tmpDir,
      ignore: [],
      maxDepth: 10,
      includeStats: false,
      respectGitignore: false,
    });

    expect(result.extensions).toBeUndefined();
  });

  test("totalDirectories does not count root", async () => {
    const result = await scan({
      root: tmpDir,
      ignore: [],
      maxDepth: 10,
      includeStats: false,
      respectGitignore: false,
    });

    // We have src/ and dist/ as subdirectories (root excluded)
    expect(result.totalDirectories).toBe(2);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

function flattenNames(node: FileNode): string[] {
  const names = [node.name];
  for (const child of node.children ?? []) {
    names.push(...flattenNames(child));
  }
  return names;
}
