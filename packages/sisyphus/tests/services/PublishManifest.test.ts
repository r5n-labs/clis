import { describe, expect, test } from "bun:test";
import { Exit } from "@r5n/cli-core";
import { Package } from "../../src/domain/Package";
import type { CatalogMap, WorkspaceVersionMap } from "../../src/services/PublishManifest";
import {
  createPublishManifest,
  extractCatalogs,
  renderPublishManifest,
  resolveCatalogVersion,
  resolveDependencies,
  resolveWorkspaceVersion,
  workspaceVersionsFromPackages,
} from "../../src/services/PublishManifest";

const workspaceVersions: WorkspaceVersionMap = {
  "@org/core": "1.2.3",
  "@org/unversioned": null,
  "@org/utils": "0.5.0",
};

const catalogs: CatalogMap = { default: { react: "^19.0.0", zod: "3.24.1" }, testing: { vitest: "^2.0.0" } };

describe("PublishManifest", () => {
  describe("resolveWorkspaceVersion", () => {
    test("workspace:* pins the exact workspace version", () => {
      expect(resolveWorkspaceVersion("@org/core", "workspace:*", workspaceVersions, "@org/app")).toBe("1.2.3");
    });

    test("workspace:^ produces a caret range", () => {
      expect(resolveWorkspaceVersion("@org/core", "workspace:^", workspaceVersions, "@org/app")).toBe("^1.2.3");
    });

    test("workspace:~ produces a tilde range", () => {
      expect(resolveWorkspaceVersion("@org/core", "workspace:~", workspaceVersions, "@org/app")).toBe("~1.2.3");
    });

    test("workspace:<range> keeps the explicit range", () => {
      expect(resolveWorkspaceVersion("@org/core", "workspace:^2.0.0", workspaceVersions, "@org/app")).toBe("^2.0.0");
    });

    test("unknown workspace package throws Exit", () => {
      expect(() => resolveWorkspaceVersion("@org/missing", "workspace:*", workspaceVersions, "@org/app")).toThrow(Exit);
      expect(() => resolveWorkspaceVersion("@org/missing", "workspace:*", workspaceVersions, "@org/app")).toThrow(
        'Workspace package "@org/missing" (required by @org/app) was not found in the workspace',
      );
    });

    test("workspace package without a version throws Exit for *", () => {
      expect(() => resolveWorkspaceVersion("@org/unversioned", "workspace:*", workspaceVersions, "@org/app")).toThrow(
        'Workspace package "@org/unversioned" (required by @org/app) has no version in its package.json',
      );
    });

    test("workspace package without a version throws Exit for ^", () => {
      expect(() => resolveWorkspaceVersion("@org/unversioned", "workspace:^", workspaceVersions, "@org/app")).toThrow(
        Exit,
      );
    });

    test("bare workspace: specifier throws Exit", () => {
      expect(() => resolveWorkspaceVersion("@org/core", "workspace:", workspaceVersions, "@org/app")).toThrow(
        'Invalid workspace specifier "workspace:" for "@org/core" (required by @org/app)',
      );
    });
  });

  describe("resolveCatalogVersion", () => {
    test("catalog: resolves from the default catalog", () => {
      expect(resolveCatalogVersion("react", "catalog:", catalogs, "@org/app")).toBe("^19.0.0");
    });

    test("catalog:<name> resolves from a named catalog", () => {
      expect(resolveCatalogVersion("vitest", "catalog:testing", catalogs, "@org/app")).toBe("^2.0.0");
    });

    test("missing catalog entry throws Exit", () => {
      expect(() => resolveCatalogVersion("react", "catalog:testing", catalogs, "@org/app")).toThrow(
        'Catalog "testing" has no entry for "react" (required by @org/app)',
      );
    });

    test("unknown catalog throws Exit", () => {
      expect(() => resolveCatalogVersion("react", "catalog:nope", catalogs, "@org/app")).toThrow(Exit);
    });
  });

  describe("extractCatalogs", () => {
    test("merges top-level catalog and catalogs", () => {
      const result = extractCatalogs({ catalog: { react: "^19.0.0" }, catalogs: { testing: { vitest: "^2.0.0" } } });
      expect(result.default).toEqual({ react: "^19.0.0" });
      expect(result.testing).toEqual({ vitest: "^2.0.0" });
    });

    test("merges catalog and catalogs nested under workspaces", () => {
      const result = extractCatalogs({
        workspaces: {
          catalog: { zod: "3.24.1" },
          catalogs: { testing: { vitest: "^2.0.0" } },
          packages: ["packages/*"],
        },
      });
      expect(result.default).toEqual({ zod: "3.24.1" });
      expect(result.testing).toEqual({ vitest: "^2.0.0" });
    });

    test("workspaces catalog overrides top-level default entries", () => {
      const result = extractCatalogs({ catalog: { zod: "3.0.0" }, workspaces: { catalog: { zod: "3.24.1" } } });
      expect(result.default).toEqual({ zod: "3.24.1" });
    });

    test("array workspaces yields an empty default catalog", () => {
      expect(extractCatalogs({ workspaces: ["packages/*"] })).toEqual({ default: {} });
    });
  });

  describe("resolveDependencies", () => {
    test("returns undefined for undefined deps", () => {
      expect(resolveDependencies(undefined, catalogs, workspaceVersions, "@org/app")).toBeUndefined();
    });

    test("passes through regular semver specifiers untouched", () => {
      const deps = { "left-pad": "^1.3.0" };
      expect(resolveDependencies(deps, catalogs, workspaceVersions, "@org/app")).toEqual({ "left-pad": "^1.3.0" });
    });

    test("resolves a mix of workspace, catalog, and plain specifiers", () => {
      const deps = { "@org/core": "workspace:*", "left-pad": "^1.3.0", react: "catalog:" };
      expect(resolveDependencies(deps, catalogs, workspaceVersions, "@org/app")).toEqual({
        "@org/core": "1.2.3",
        "left-pad": "^1.3.0",
        react: "^19.0.0",
      });
    });
  });

  describe("createPublishManifest", () => {
    test("drops devDependencies", () => {
      const manifest = { devDependencies: { typescript: "catalog:" }, name: "@org/app", version: "1.0.0" };
      const result = createPublishManifest(manifest, catalogs, workspaceVersions);
      expect(result.devDependencies).toBeUndefined();
    });

    test("resolves dependencies, optionalDependencies, and peerDependencies", () => {
      const manifest = {
        dependencies: { "@org/core": "workspace:*" },
        name: "@org/app",
        optionalDependencies: { "@org/utils": "workspace:^" },
        peerDependencies: { react: "catalog:" },
        version: "1.0.0",
      };
      const result = createPublishManifest(manifest, catalogs, workspaceVersions);
      expect(result.dependencies).toEqual({ "@org/core": "1.2.3" });
      expect(result.optionalDependencies).toEqual({ "@org/utils": "^0.5.0" });
      expect(result.peerDependencies).toEqual({ react: "^19.0.0" });
    });

    test("preserves unrelated fields", () => {
      const manifest = {
        bin: { app: "dist/index.js" },
        license: "Apache-2.0",
        name: "@org/app",
        private: false,
        scripts: { build: "bun build.ts" },
        version: "1.0.0",
      };
      const result = createPublishManifest(manifest, catalogs, workspaceVersions);
      expect(result.bin).toEqual({ app: "dist/index.js" });
      expect(result.license).toBe("Apache-2.0");
      expect(result.private).toBe(false);
      expect(result.scripts).toEqual({ build: "bun build.ts" });
      expect(result.name).toBe("@org/app");
      expect(result.version).toBe("1.0.0");
    });

    test("manifest without any dependency fields stays intact", () => {
      const manifest = { name: "@org/app", version: "1.0.0" };
      const result = createPublishManifest(manifest, catalogs, workspaceVersions);
      expect(result).toEqual({ name: "@org/app", version: "1.0.0" });
    });
  });

  describe("renderPublishManifest", () => {
    test("resolves specifiers and drops devDependencies in the rendered text", () => {
      const original = `${JSON.stringify(
        {
          dependencies: { "@org/core": "workspace:*", react: "catalog:" },
          devDependencies: { typescript: "^5.0.0" },
          name: "@org/app",
          version: "1.0.0",
        },
        null,
        2,
      )}\n`;
      const parsed = JSON.parse(renderPublishManifest(original, catalogs, workspaceVersions));
      expect(parsed.dependencies).toEqual({ "@org/core": "1.2.3", react: "^19.0.0" });
      expect(parsed.devDependencies).toBeUndefined();
    });

    test("preserves the original indentation and trailing newline", () => {
      const original = `{\n    "name": "@org/app",\n    "version": "1.0.0"\n}\n`;
      const result = renderPublishManifest(original, catalogs, workspaceVersions);
      expect(result).toBe(`{\n    "name": "@org/app",\n    "version": "1.0.0"\n}\n`);
    });

    test("preserves tab indentation", () => {
      const original = `{\n\t"name": "@org/app",\n\t"version": "1.0.0"\n}\n`;
      const result = renderPublishManifest(original, catalogs, workspaceVersions);
      expect(result).toStartWith(`{\n\t"name"`);
    });
  });

  describe("workspaceVersionsFromPackages", () => {
    test("maps package names to their versions", () => {
      const packages = [
        new Package({ file: "packages/core/package.json", name: "@org/core", version: "1.2.3" }),
        new Package({ file: "packages/utils/package.json", name: "@org/utils", version: "0.5.0" }),
      ];
      expect(workspaceVersionsFromPackages(packages)).toEqual({ "@org/core": "1.2.3", "@org/utils": "0.5.0" });
    });

    test("maps an empty version to null", () => {
      const packages = [new Package({ file: "packages/x/package.json", name: "@org/x", version: "" })];
      expect(workspaceVersionsFromPackages(packages)).toEqual({ "@org/x": null });
    });
  });
});
