import { describe, expect, test } from "bun:test";
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

const workspaceVersions: WorkspaceVersionMap = { "@r5n/cli-core": "1.2.3", "@r5n/no-version": null };

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
