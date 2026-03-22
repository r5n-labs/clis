import { describe, expect, test } from "bun:test";

import type { FileNode } from "../../src/services/CodebaseScanner";
import {
  buildOptions,
  collectAllFiles,
  collectExtensionCounts,
  countChildren,
  formatSize,
} from "../../src/commands/explore";

// ── collectAllFiles ──────────────────────────────────────────────────

describe("collectAllFiles", () => {
  test("returns single file node in array", () => {
    const node: FileNode = { name: "index.ts", type: "file", path: "index.ts" };
    const result = collectAllFiles(node);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("index.ts");
  });

  test("flattens nested directories into file nodes", () => {
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
            { name: "a.ts", type: "file", path: "src/a.ts" },
            { name: "b.ts", type: "file", path: "src/b.ts" },
          ],
        },
        { name: "c.ts", type: "file", path: "c.ts" },
      ],
    };
    const result = collectAllFiles(tree);
    expect(result).toHaveLength(3);
    const names = result.map((f) => f.name);
    expect(names).toContain("a.ts");
    expect(names).toContain("b.ts");
    expect(names).toContain("c.ts");
  });

  test("returns empty array for empty directory", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty", children: [] };
    expect(collectAllFiles(node)).toEqual([]);
  });

  test("only returns file nodes, not directory nodes", () => {
    const tree: FileNode = {
      name: "root",
      type: "directory",
      path: ".",
      children: [
        {
          name: "sub",
          type: "directory",
          path: "sub",
          children: [
            { name: "file.ts", type: "file", path: "sub/file.ts" },
          ],
        },
      ],
    };
    const result = collectAllFiles(tree);
    expect(result).toHaveLength(1);
    expect(result.every((n) => n.type === "file")).toBe(true);
  });

  test("handles directory with undefined children", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty" };
    expect(collectAllFiles(node)).toEqual([]);
  });
});

// ── collectExtensionCounts ───────────────────────────────────────────

describe("collectExtensionCounts", () => {
  test("returns extension count for a single file", () => {
    const node: FileNode = { name: "app.ts", type: "file", path: "app.ts", extension: ".ts" };
    expect(collectExtensionCounts(node)).toEqual({ ".ts": 1 });
  });

  test("returns empty for file without extension", () => {
    const node: FileNode = { name: "Makefile", type: "file", path: "Makefile" };
    expect(collectExtensionCounts(node)).toEqual({});
  });

  test("aggregates counts across nested tree", () => {
    const tree: FileNode = {
      name: ".",
      type: "directory",
      path: ".",
      children: [
        { name: "a.ts", type: "file", path: "a.ts", extension: ".ts" },
        { name: "b.ts", type: "file", path: "b.ts", extension: ".ts" },
        { name: "c.css", type: "file", path: "c.css", extension: ".css" },
        {
          name: "sub",
          type: "directory",
          path: "sub",
          children: [
            { name: "d.ts", type: "file", path: "sub/d.ts", extension: ".ts" },
          ],
        },
      ],
    };
    const result = collectExtensionCounts(tree);
    expect(result).toEqual({ ".ts": 3, ".css": 1 });
  });

  test("returns empty for empty directory", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty", children: [] };
    expect(collectExtensionCounts(node)).toEqual({});
  });
});

// ── countChildren ────────────────────────────────────────────────────

describe("countChildren", () => {
  test("counts direct file and directory children", () => {
    const node: FileNode = {
      name: "root",
      type: "directory",
      path: ".",
      children: [
        { name: "src", type: "directory", path: "src", children: [] },
        { name: "lib", type: "directory", path: "lib", children: [] },
        { name: "index.ts", type: "file", path: "index.ts" },
        { name: "config.json", type: "file", path: "config.json" },
        { name: "README.md", type: "file", path: "README.md" },
      ],
    };
    const result = countChildren(node);
    expect(result).toEqual({ files: 3, dirs: 2 });
  });

  test("returns zero for empty directory", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty", children: [] };
    expect(countChildren(node)).toEqual({ files: 0, dirs: 0 });
  });

  test("does not count nested grandchildren", () => {
    const node: FileNode = {
      name: "root",
      type: "directory",
      path: ".",
      children: [
        {
          name: "src",
          type: "directory",
          path: "src",
          children: [
            { name: "deep.ts", type: "file", path: "src/deep.ts" },
          ],
        },
      ],
    };
    const result = countChildren(node);
    expect(result).toEqual({ files: 0, dirs: 1 });
  });

  test("handles node with undefined children", () => {
    const node: FileNode = { name: "empty", type: "directory", path: "empty" };
    expect(countChildren(node)).toEqual({ files: 0, dirs: 0 });
  });
});

// ── formatSize ───────────────────────────────────────────────────────

describe("formatSize", () => {
  test("formats bytes below 1 KB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  test("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(10240)).toBe("10.0 KB");
  });

  test("formats megabytes", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  test("exactly 1024 is 1.0 KB, not bytes", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
  });
});

// ── buildOptions ─────────────────────────────────────────────────────

describe("buildOptions", () => {
  const sampleTree: FileNode = {
    name: "root",
    type: "directory",
    path: ".",
    children: [
      {
        name: "src",
        type: "directory",
        path: "src",
        children: [
          { name: "index.ts", type: "file", path: "src/index.ts" },
        ],
      },
      { name: "README.md", type: "file", path: "README.md", extension: ".md" },
    ],
  };

  test("includes Search and Stats actions", () => {
    const { options } = buildOptions(sampleTree, false);
    const values = options.map((o) => o.value);
    expect(values).toContain("__search__");
    expect(values).toContain("__stats__");
  });

  test("includes back option when canGoBack is true", () => {
    const { options } = buildOptions(sampleTree, true);
    const values = options.map((o) => o.value);
    expect(values).toContain("__back__");
  });

  test("excludes back option when canGoBack is false", () => {
    const { options } = buildOptions(sampleTree, false);
    const values = options.map((o) => o.value);
    expect(values).not.toContain("__back__");
  });

  test("populates childMap with child nodes by path", () => {
    const { childMap } = buildOptions(sampleTree, false);
    expect(childMap.has("src")).toBe(true);
    expect(childMap.has("README.md")).toBe(true);
    expect(childMap.get("src")!.type).toBe("directory");
    expect(childMap.get("README.md")!.type).toBe("file");
  });

  test("creates options for each child", () => {
    const { options } = buildOptions(sampleTree, false);
    const values = options.map((o) => o.value);
    expect(values).toContain("src");
    expect(values).toContain("README.md");
  });

  test("directory hint shows child counts", () => {
    const { options } = buildOptions(sampleTree, false);
    const srcOption = options.find((o) => o.value === "src");
    expect(srcOption).toBeDefined();
    expect(srcOption!.hint).toContain("1 file");
  });

  test("file hint shows extension", () => {
    const { options } = buildOptions(sampleTree, false);
    const readmeOption = options.find((o) => o.value === "README.md");
    expect(readmeOption).toBeDefined();
    expect(readmeOption!.hint).toContain(".md");
  });

  test("file with size shows formatted size in hint", () => {
    const tree: FileNode = {
      name: "root",
      type: "directory",
      path: ".",
      children: [
        { name: "big.js", type: "file", path: "big.js", extension: ".js", size: 2048 },
      ],
    };
    const { options } = buildOptions(tree, false);
    const fileOption = options.find((o) => o.value === "big.js");
    expect(fileOption).toBeDefined();
    expect(fileOption!.hint).toContain("2.0 KB");
  });

  test("empty directory shows 'empty' hint", () => {
    const tree: FileNode = {
      name: "root",
      type: "directory",
      path: ".",
      children: [
        { name: "empty-dir", type: "directory", path: "empty-dir", children: [] },
      ],
    };
    const { options } = buildOptions(tree, false);
    const dirOption = options.find((o) => o.value === "empty-dir");
    expect(dirOption).toBeDefined();
    expect(dirOption!.hint).toBe("empty");
  });
});
