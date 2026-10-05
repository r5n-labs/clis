import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogMap, RootManifest, WorkspaceVersionMap } from "./publish-manifest";
import {
  extractCatalogs,
  extractWorkspaceGlobs,
  PublishManifestError,
  renderPublishManifest,
} from "./publish-manifest";

const catalogs: CatalogMap = { default: { "left-pad": "1.3.0" }, react19: { react: "19.0.0" } };

const workspaceVersions: WorkspaceVersionMap = {
  "@r5n/cli-core": { isPrivate: false, version: "1.2.3" },
  "@r5n/no-version": { isPrivate: false, version: null },
  "@r5n/private-core": { isPrivate: true, version: "0.2.2" },
};

const CATALOG_HINT = "Add the entry to the root package.json catalog before publishing";
const MISSING_WORKSPACE_HINT = "Check the dependency name against your workspaces globs";
const MISSING_VERSION_HINT = "Add a version field before publishing";
const PRIVATE_MESSAGE =
  '"@r5n/hydra" depends on private workspace package "@r5n/private-core", which is not published to the registry';
const PRIVATE_HINT =
  'Move "@r5n/private-core" to devDependencies (bundled CLIs do not need it at runtime) or publish it first';

function render(manifest: Record<string, unknown>, ownCatalogs = catalogs, ownWorkspaces = workspaceVersions): unknown {
  return JSON.parse(
    renderPublishManifest(JSON.stringify({ name: "@r5n/hydra", ...manifest }), ownCatalogs, ownWorkspaces),
  );
}

function renderFailure(dependencies: Record<string, string>): PublishManifestError {
  try {
    render({ dependencies });
  } catch (error) {
    if (error instanceof PublishManifestError) return error;
    throw error;
  }
  throw new Error(`Expected ${JSON.stringify(dependencies)} to be rejected`);
}

function manifestText(indent: string): string {
  return `{\n${indent}"name": "@r5n/hydra",\n${indent}"bin": {\n${indent}${indent}"hydra": "./dist/cli.js"\n${indent}}\n}\n`;
}

describe("renderPublishManifest", () => {
  test.each([
    ["workspace:*", "@r5n/cli-core", "1.2.3"],
    ["workspace:^", "@r5n/cli-core", "^1.2.3"],
    ["workspace:~", "@r5n/cli-core", "~1.2.3"],
    ["workspace:2.0.0", "@r5n/cli-core", "2.0.0"],
    ["workspace:^2.0.0", "@r5n/cli-core", "^2.0.0"],
    ["workspace:~2.0.0", "@r5n/cli-core", "~2.0.0"],
    ["catalog:", "left-pad", "1.3.0"],
    ["catalog:react19", "react", "19.0.0"],
    ["^1.3.0", "mri", "^1.3.0"],
  ])("resolves %s for %s to %s", (specifier, name, expected) => {
    expect(render({ dependencies: { [name]: specifier } })).toEqual({
      name: "@r5n/hydra",
      dependencies: { [name]: expected },
    });
  });

  test.each([
    [
      "workspace:*",
      "@r5n/missing",
      'Workspace package "@r5n/missing" (required by @r5n/hydra) was not found in the workspace',
      MISSING_WORKSPACE_HINT,
    ],
    [
      "workspace:^1.0.0",
      "constructor",
      'Workspace package "constructor" (required by @r5n/hydra) was not found in the workspace',
      MISSING_WORKSPACE_HINT,
    ],
    ["workspace:*", "@r5n/private-core", PRIVATE_MESSAGE, PRIVATE_HINT],
    ["workspace:0.2.2", "@r5n/private-core", PRIVATE_MESSAGE, PRIVATE_HINT],
    [
      "workspace:*",
      "@r5n/no-version",
      'Workspace package "@r5n/no-version" (required by @r5n/hydra) has no version in its package.json',
      MISSING_VERSION_HINT,
    ],
    [
      "workspace:^",
      "@r5n/no-version",
      'Workspace package "@r5n/no-version" (required by @r5n/hydra) has no version in its package.json',
      MISSING_VERSION_HINT,
    ],
    [
      "workspace:",
      "@r5n/cli-core",
      'Invalid workspace specifier "workspace:" for "@r5n/cli-core" (required by @r5n/hydra)',
      "Use workspace:*, workspace:^, workspace:~, or workspace:<range>",
    ],
    ["catalog:", "react", 'Catalog "default" has no entry for "react" (required by @r5n/hydra)', CATALOG_HINT],
    [
      "catalog:react19",
      "left-pad",
      'Catalog "react19" has no entry for "left-pad" (required by @r5n/hydra)',
      CATALOG_HINT,
    ],
    ["catalog:vue", "react", 'Catalog "vue" has no entry for "react" (required by @r5n/hydra)', CATALOG_HINT],
    [
      "catalog:",
      "constructor",
      'Catalog "default" has no entry for "constructor" (required by @r5n/hydra)',
      CATALOG_HINT,
    ],
    [
      "catalog:constructor",
      "constructor",
      'Catalog "constructor" has no entry for "constructor" (required by @r5n/hydra)',
      CATALOG_HINT,
    ],
  ])("rejects %s for %s", (specifier, name, message, hint) => {
    expect(renderFailure({ [name]: specifier })).toMatchObject({ hint, message });
  });

  test("resolves every published dependency section, drops devDependencies and keeps other fields", () => {
    const manifest = {
      bin: { hydra: "./dist/cli.js" },
      dependencies: { "@r5n/cli-core": "workspace:*", "left-pad": "catalog:", mri: "1.2.0" },
      devDependencies: { "@r5n/private-core": "workspace:*", typescript: "catalog:" },
      license: "Apache-2.0",
      optionalDependencies: { "@r5n/cli-core": "workspace:~", react: "catalog:react19" },
      peerDependencies: { "@r5n/cli-core": "workspace:^" },
      private: false,
      scripts: { build: "bun build.ts" },
      version: "0.5.8",
    };

    expect(render(manifest)).toEqual({
      bin: { hydra: "./dist/cli.js" },
      dependencies: { "@r5n/cli-core": "1.2.3", "left-pad": "1.3.0", mri: "1.2.0" },
      license: "Apache-2.0",
      name: "@r5n/hydra",
      optionalDependencies: { "@r5n/cli-core": "~1.2.3", react: "19.0.0" },
      peerDependencies: { "@r5n/cli-core": "^1.2.3" },
      private: false,
      scripts: { build: "bun build.ts" },
      version: "0.5.8",
    });
  });

  test("preserves declared prototype-named catalogue and workspace dependencies", () => {
    const ownCatalogs = extractCatalogs(JSON.parse('{"catalogs":{"__proto__":{"constructor":"2.0.0"}}}'));
    const ownWorkspaces = { constructor: { isPrivate: false, version: "2.0.0" } };
    const manifest = {
      dependencies: { constructor: "catalog:__proto__" },
      peerDependencies: { constructor: "workspace:^" },
    };

    expect(render(manifest, ownCatalogs, ownWorkspaces)).toEqual({
      name: "@r5n/hydra",
      dependencies: { constructor: "2.0.0" },
      peerDependencies: { constructor: "^2.0.0" },
    });
  });

  test.each([
    ["four-space", manifestText("    "), manifestText("    ")],
    ["tab", manifestText("\t"), manifestText("\t")],
    ["single-line", '{"name":"@r5n/hydra","bin":{"hydra":"./dist/cli.js"}}', manifestText("  ")],
  ])("renders a %s manifest in its own indentation, defaulting to two spaces", (_layout, original, expected) => {
    expect(renderPublishManifest(original, catalogs, workspaceVersions)).toBe(expected);
  });
});

describe("extractCatalogs", () => {
  test.each<[string, RootManifest, CatalogMap]>([
    [
      "merges root and workspaces catalogue sources",
      {
        catalog: { a: "1.0.0" },
        catalogs: { named: { b: "2.0.0" } },
        workspaces: { catalog: { c: "3.0.0" }, catalogs: { other: { d: "4.0.0" } }, packages: ["packages/*"] },
      },
      { default: { a: "1.0.0", c: "3.0.0" }, named: { b: "2.0.0" }, other: { d: "4.0.0" } },
    ],
    [
      "lets the workspaces catalogue override root default entries",
      { catalog: { zod: "3.0.0" }, workspaces: { catalog: { zod: "3.24.1" } } },
      { default: { zod: "3.24.1" } },
    ],
    ["returns an empty default catalogue for array workspaces", { workspaces: ["packages/*"] }, { default: {} }],
  ])("%s", (_name, rootManifest, expected) => {
    expect(extractCatalogs(rootManifest)).toEqual(expected);
  });
});

describe("extractWorkspaceGlobs", () => {
  test.each<[string, RootManifest, string[]]>([
    ["the array form", { workspaces: ["packages/*", "tools"] }, ["packages/*", "tools"]],
    ["the object form", { workspaces: { packages: ["packages/*"] } }, ["packages/*"]],
    ["a missing workspaces field", {}, []],
  ])("reads %s", (_name, rootManifest, expected) => {
    expect(extractWorkspaceGlobs(rootManifest)).toEqual(expected);
  });
});

describe("prepare-publish dependency membership", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  test.each([
    {
      specifier: "catalog:",
      expected: undefined,
      output: ['Catalog "default" has no entry for "constructor" (required by fixture)', CATALOG_HINT],
    },
    {
      specifier: "catalog:constructor",
      expected: undefined,
      output: ['Catalog "constructor" has no entry for "constructor" (required by fixture)', CATALOG_HINT],
    },
    {
      specifier: "workspace:^1.0.0",
      expected: undefined,
      output: [
        'Workspace package "constructor" (required by fixture) was not found in the workspace',
        MISSING_WORKSPACE_HINT,
      ],
    },
    { specifier: "catalog:__proto__", expected: "2.0.0", output: [] },
    { specifier: "workspace:^", expected: "^2.0.0", output: [] },
  ])("prepares only declared entries for $specifier", async ({ specifier, expected, output }) => {
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
      for (const line of output) expect(stdout + stderr).toContain(line);
      expect(readFileSync(manifestPath, "utf8")).toBe(original);
    }
  });
});
