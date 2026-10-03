import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogMap, WorkspaceVersionMap } from "./publish-manifest";
import {
  createPublishManifest,
  extractCatalogs,
  extractWorkspaceGlobs,
  resolveCatalogVersion,
  resolveDependencies,
  resolveWorkspaceVersion,
} from "./publish-manifest";

const catalogs: CatalogMap = { default: { "left-pad": "1.3.0" }, react19: { react: "19.0.0" } };

const workspaceVersions: WorkspaceVersionMap = {
  "@r5n/cli-core": { isPrivate: false, version: "1.2.3" },
  "@r5n/no-version": { isPrivate: false, version: null },
  "@r5n/private-core": { isPrivate: true, version: "0.2.2" },
};

describe("resolveWorkspaceVersion", () => {
  test("workspace:* resolves to the exact pinned version", () => {
    expect(resolveWorkspaceVersion("@r5n/cli-core", "workspace:*", workspaceVersions, "@r5n/hydra")).toBe("1.2.3");
  });

  test("workspace:^ resolves to a caret range", () => {
    expect(resolveWorkspaceVersion("@r5n/cli-core", "workspace:^", workspaceVersions, "@r5n/hydra")).toBe("^1.2.3");
  });

  test("workspace:~ resolves to a tilde range", () => {
    expect(resolveWorkspaceVersion("@r5n/cli-core", "workspace:~", workspaceVersions, "@r5n/hydra")).toBe("~1.2.3");
  });

  test("workspace:<version> strips the prefix and keeps the specifier", () => {
    expect(resolveWorkspaceVersion("@r5n/cli-core", "workspace:1.2.3", workspaceVersions, "@r5n/hydra")).toBe("1.2.3");
    expect(resolveWorkspaceVersion("@r5n/cli-core", "workspace:^1.2.3", workspaceVersions, "@r5n/hydra")).toBe(
      "^1.2.3",
    );
    expect(resolveWorkspaceVersion("@r5n/cli-core", "workspace:~1.2.3", workspaceVersions, "@r5n/hydra")).toBe(
      "~1.2.3",
    );
  });

  test("throws when the workspace package is unknown", () => {
    expect(() => resolveWorkspaceVersion("@r5n/missing", "workspace:*", workspaceVersions, "@r5n/hydra")).toThrow(
      'Workspace package "@r5n/missing" (required by @r5n/hydra) was not found in the workspace',
    );
  });

  test("throws when the workspace package has no version", () => {
    expect(() => resolveWorkspaceVersion("@r5n/no-version", "workspace:*", workspaceVersions, "@r5n/hydra")).toThrow(
      'Workspace package "@r5n/no-version" (required by @r5n/hydra) has no version in its package.json',
    );
  });

  test("throws on a private workspace package", () => {
    expect(() => resolveWorkspaceVersion("@r5n/private-core", "workspace:*", workspaceVersions, "@r5n/hydra")).toThrow(
      'depends on private workspace package "@r5n/private-core"',
    );
  });

  test("throws on a bare workspace: specifier", () => {
    expect(() => resolveWorkspaceVersion("@r5n/cli-core", "workspace:", workspaceVersions, "@r5n/hydra")).toThrow(
      'Invalid workspace specifier "workspace:" for "@r5n/cli-core" (required by @r5n/hydra)',
    );
  });
});

describe("resolveCatalogVersion", () => {
  test("resolves catalog: from the default catalog", () => {
    expect(resolveCatalogVersion("left-pad", "catalog:", catalogs, "@r5n/hydra")).toBe("1.3.0");
  });

  test("resolves catalog:<name> from a named catalog", () => {
    expect(resolveCatalogVersion("react", "catalog:react19", catalogs, "@r5n/hydra")).toBe("19.0.0");
  });

  test("throws when the catalog has no entry", () => {
    expect(() => resolveCatalogVersion("react", "catalog:", catalogs, "@r5n/hydra")).toThrow(
      'Catalog "default" has no entry for "react" (required by @r5n/hydra)',
    );
  });

  test("throws when the named catalog is unknown", () => {
    expect(() => resolveCatalogVersion("react", "catalog:vue", catalogs, "@r5n/hydra")).toThrow(
      'Catalog "vue" has no entry for "react" (required by @r5n/hydra)',
    );
  });
});

describe("resolveDependencies", () => {
  test("resolves catalog and workspace protocols and passes plain versions through", () => {
    const resolved = resolveDependencies(
      { "@r5n/cli-core": "workspace:*", "left-pad": "catalog:", mri: "1.2.0", react: "catalog:react19" },
      catalogs,
      workspaceVersions,
      "@r5n/hydra",
    );

    expect(resolved).toEqual({ "@r5n/cli-core": "1.2.3", "left-pad": "1.3.0", mri: "1.2.0", react: "19.0.0" });
  });

  test("returns undefined for undefined dependency maps", () => {
    expect(resolveDependencies(undefined, catalogs, workspaceVersions, "@r5n/hydra")).toBeUndefined();
  });
});

describe("createPublishManifest", () => {
  test.each([
    ["catalog:", 'Catalog "default" has no entry for "constructor"'],
    ["catalog:constructor", 'Catalog "constructor" has no entry for "constructor"'],
    ["workspace:^1.0.0", 'Workspace package "constructor"'],
  ])("rejects an inherited missing dependency before serialising %s", (specifier, message) => {
    expect(() =>
      JSON.stringify(
        createPublishManifest({ name: "fixture", dependencies: { constructor: specifier } }, extractCatalogs({}), {}),
      ),
    ).toThrow(message);
  });

  test("preserves declared prototype-named catalogue and workspace dependencies", () => {
    const ownCatalogs = extractCatalogs(JSON.parse('{"catalogs":{"__proto__":{"constructor":"2.0.0"}}}'));
    const manifest = createPublishManifest(
      {
        name: "fixture",
        dependencies: { constructor: "catalog:__proto__" },
        peerDependencies: { constructor: "workspace:^" },
      },
      ownCatalogs,
      { constructor: { isPrivate: false, version: "2.0.0" } },
    );

    expect(JSON.parse(JSON.stringify(manifest))).toEqual({
      name: "fixture",
      dependencies: { constructor: "2.0.0" },
      peerDependencies: { constructor: "^2.0.0" },
    });
  });

  test("drops devDependencies and resolves all dependency sections", () => {
    const manifest = createPublishManifest(
      {
        dependencies: { "@r5n/cli-core": "workspace:*" },
        devDependencies: { "@r5n/tools": "workspace:*", typescript: "5.0.0" },
        name: "@r5n/hydra",
        optionalDependencies: { "left-pad": "catalog:" },
        peerDependencies: { "@r5n/cli-core": "workspace:^" },
        version: "0.5.8",
      },
      catalogs,
      workspaceVersions,
    );

    expect(manifest).toEqual({
      dependencies: { "@r5n/cli-core": "1.2.3" },
      name: "@r5n/hydra",
      optionalDependencies: { "left-pad": "1.3.0" },
      peerDependencies: { "@r5n/cli-core": "^1.2.3" },
      version: "0.5.8",
    });
    expect(manifest.devDependencies).toBeUndefined();
  });

  test("preserves unrelated manifest fields", () => {
    const manifest = createPublishManifest(
      { bin: { hydra: "./dist/cli.js" }, name: "@r5n/hydra", version: "0.5.8" },
      catalogs,
      workspaceVersions,
    );

    expect(manifest.bin).toEqual({ hydra: "./dist/cli.js" });
  });
});

describe("extractCatalogs", () => {
  test("merges catalog sources from root and workspaces object", () => {
    const extracted = extractCatalogs({
      catalog: { a: "1.0.0" },
      catalogs: { named: { b: "2.0.0" } },
      workspaces: { catalog: { c: "3.0.0" }, catalogs: { other: { d: "4.0.0" } }, packages: ["packages/*"] },
    });

    expect(extracted).toEqual({ default: { a: "1.0.0", c: "3.0.0" }, named: { b: "2.0.0" }, other: { d: "4.0.0" } });
  });

  test("returns an empty default catalog when none is defined", () => {
    expect(extractCatalogs({ workspaces: ["packages/*"] })).toEqual({ default: {} });
  });
});

describe("extractWorkspaceGlobs", () => {
  test("supports the array form", () => {
    expect(extractWorkspaceGlobs({ workspaces: ["packages/*", "tools"] })).toEqual(["packages/*", "tools"]);
  });

  test("supports the object form", () => {
    expect(extractWorkspaceGlobs({ workspaces: { packages: ["packages/*"] } })).toEqual(["packages/*"]);
  });

  test("returns an empty list when workspaces is missing", () => {
    expect(extractWorkspaceGlobs({})).toEqual([]);
  });
});

describe("prepare-publish dependency membership", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  test.each([
    { specifier: "catalog:", expected: undefined },
    { specifier: "catalog:constructor", expected: undefined },
    { specifier: "workspace:^1.0.0", expected: undefined },
    { specifier: "catalog:__proto__", expected: "2.0.0" },
    { specifier: "workspace:^", expected: "^2.0.0" },
  ])("prepares only declared entries for $specifier", async ({ specifier, expected }) => {
    const root = mkdtempSync(join(tmpdir(), "prepare-membership-"));
    roots.push(root);
    const packageDirectory = join(root, "packages", "fixture");
    mkdirSync(packageDirectory, { recursive: true });
    const original = JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { constructor: specifier } });
    const manifestPath = join(packageDirectory, "package.json");
    writeFileSync(manifestPath, original);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
        ...(expected ? { catalogs: { ["__proto__"]: { constructor: "2.0.0" } } } : {}),
      }),
    );
    if (expected) {
      const dependencyDirectory = join(root, "packages", "constructor");
      mkdirSync(dependencyDirectory, { recursive: true });
      writeFileSync(
        join(dependencyDirectory, "package.json"),
        JSON.stringify({ name: "constructor", version: "2.0.0" }),
      );
    }
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "prepare-publish.ts"), packageDirectory], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    if (expected) {
      expect(exitCode).toBe(0);
      expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual({
        name: "fixture",
        version: "1.0.0",
        dependencies: { constructor: expected },
      });
    } else {
      expect(exitCode).toBe(1);
      expect(stdout + stderr).toContain(
        specifier.startsWith("workspace:") ? "was not found in the workspace" : 'has no entry for "constructor"',
      );
      expect(readFileSync(manifestPath, "utf8")).toBe(original);
    }
  });
});
