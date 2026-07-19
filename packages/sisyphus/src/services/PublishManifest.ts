import { Exit } from "@r5n/cli-core";
import type { Package } from "../domain";

const CATALOG_PREFIX = "catalog:";
const WORKSPACE_PREFIX = "workspace:";
const DEFAULT_CATALOG = "default";
const DEFAULT_INDENT = 2;
const RANGE_ONLY_SPECIFIERS = new Set(["*", "^", "~"]);

export type DependencyMap = Record<string, string>;
export type CatalogMap = Record<string, DependencyMap>;
export type WorkspaceEntry = { version: string | null; isPrivate: boolean };
export type WorkspaceVersionMap = Record<string, WorkspaceEntry>;

export type PackageManifest = {
  name: string;
  version?: string;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
  [key: string]: unknown;
};

export type RootManifest = {
  workspaces?: string[] | { packages?: string[]; catalog?: DependencyMap; catalogs?: CatalogMap };
  catalog?: DependencyMap;
  catalogs?: CatalogMap;
  [key: string]: unknown;
};

export function extractCatalogs(rootPkg: RootManifest): CatalogMap {
  const workspaces = Array.isArray(rootPkg.workspaces) ? undefined : rootPkg.workspaces;
  const catalogs: CatalogMap = { [DEFAULT_CATALOG]: { ...rootPkg.catalog, ...workspaces?.catalog } };

  Object.assign(catalogs, rootPkg.catalogs, workspaces?.catalogs);

  return catalogs;
}

export function workspaceVersionsFromPackages(packages: Iterable<Package>): WorkspaceVersionMap {
  const versions: WorkspaceVersionMap = {};

  for (const pkg of packages) {
    versions[pkg.name] = { isPrivate: pkg.isPrivate, version: pkg.version || null };
  }

  return versions;
}

export function resolveCatalogVersion(
  name: string,
  specifier: string,
  catalogs: CatalogMap,
  packageName: string,
): string {
  const catalogName = specifier.slice(CATALOG_PREFIX.length) || DEFAULT_CATALOG;
  const catalogVersion = catalogs[catalogName]?.[name];

  if (!catalogVersion) {
    throw new Exit(
      `Catalog "${catalogName}" has no entry for "${name}" (required by ${packageName})`,
      "Add the entry to the root package.json catalog before publishing",
    );
  }

  return catalogVersion;
}

export function resolveWorkspaceVersion(
  name: string,
  specifier: string,
  workspaceVersions: WorkspaceVersionMap,
  packageName: string,
): string {
  const range = specifier.slice(WORKSPACE_PREFIX.length);
  const entry = workspaceVersions[name];

  if (!entry) {
    throw new Exit(
      `Workspace package "${name}" (required by ${packageName}) was not found in the workspace`,
      "Check the dependency name against your workspaces globs",
    );
  }

  if (entry.isPrivate) {
    throw new Exit(
      `"${packageName}" depends on private workspace package "${name}", which is not published to the registry`,
      `Move "${name}" to devDependencies (bundled CLIs do not need it at runtime) or publish it first`,
    );
  }

  if (!RANGE_ONLY_SPECIFIERS.has(range)) {
    if (!range) {
      throw new Exit(
        `Invalid workspace specifier "${specifier}" for "${name}" (required by ${packageName})`,
        "Use workspace:*, workspace:^, workspace:~, or workspace:<range>",
      );
    }
    return range;
  }

  const version = entry.version;
  if (!version) {
    throw new Exit(
      `Workspace package "${name}" (required by ${packageName}) has no version in its package.json`,
      "Add a version field before publishing",
    );
  }

  return range === "*" ? version : `${range}${version}`;
}

export function resolveDependencies(
  deps: DependencyMap | undefined,
  catalogs: CatalogMap,
  workspaceVersions: WorkspaceVersionMap,
  packageName: string,
): DependencyMap | undefined {
  if (!deps) return deps;

  const resolved: DependencyMap = {};

  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith(CATALOG_PREFIX)) {
      resolved[name] = resolveCatalogVersion(name, version, catalogs, packageName);
    } else if (version.startsWith(WORKSPACE_PREFIX)) {
      resolved[name] = resolveWorkspaceVersion(name, version, workspaceVersions, packageName);
    } else {
      resolved[name] = version;
    }
  }

  return resolved;
}

export function createPublishManifest(
  manifest: PackageManifest,
  catalogs: CatalogMap,
  workspaceVersions: WorkspaceVersionMap,
): PackageManifest {
  const { devDependencies: _devDependencies, ...rest } = manifest;

  return {
    ...rest,
    dependencies: resolveDependencies(manifest.dependencies, catalogs, workspaceVersions, manifest.name),
    optionalDependencies: resolveDependencies(
      manifest.optionalDependencies,
      catalogs,
      workspaceVersions,
      manifest.name,
    ),
    peerDependencies: resolveDependencies(manifest.peerDependencies, catalogs, workspaceVersions, manifest.name),
  };
}

export function renderPublishManifest(
  originalText: string,
  catalogs: CatalogMap,
  workspaceVersions: WorkspaceVersionMap,
): string {
  const manifest = JSON.parse(originalText) as PackageManifest;
  const publishManifest = createPublishManifest(manifest, catalogs, workspaceVersions);
  const indent = detectIndent(originalText);

  return `${JSON.stringify(publishManifest, null, indent)}\n`;
}

function detectIndent(content: string): string | number {
  const match = content.match(/^[\t ]+/m);
  return match ? match[0] : DEFAULT_INDENT;
}
