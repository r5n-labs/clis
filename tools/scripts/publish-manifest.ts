const CATALOG_PREFIX = "catalog:";
const WORKSPACE_PREFIX = "workspace:";
const DEFAULT_CATALOG = "default";
const RANGE_ONLY_SPECIFIERS = new Set(["*", "^", "~"]);

export type DependencyMap = Record<string, string>;
export type CatalogMap = Record<string, DependencyMap>;
export type WorkspaceVersionMap = Record<string, string | null>;

export interface PackageManifest {
  name: string;
  version?: string;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
  [key: string]: unknown;
}

export interface RootManifest {
  workspaces?: string[] | { packages?: string[]; catalog?: DependencyMap; catalogs?: CatalogMap };
  catalog?: DependencyMap;
  catalogs?: CatalogMap;
  [key: string]: unknown;
}

export function extractCatalogs(rootPkg: RootManifest): CatalogMap {
  const workspaces = Array.isArray(rootPkg.workspaces) ? undefined : rootPkg.workspaces;
  const catalogs: CatalogMap = { [DEFAULT_CATALOG]: { ...rootPkg.catalog, ...workspaces?.catalog } };

  Object.assign(catalogs, rootPkg.catalogs, workspaces?.catalogs);

  return catalogs;
}

export function extractWorkspaceGlobs(rootPkg: RootManifest): string[] {
  if (Array.isArray(rootPkg.workspaces)) return rootPkg.workspaces;
  return rootPkg.workspaces?.packages ?? [];
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
    throw new Error(`Catalog "${catalogName}" has no entry for "${name}" (required by ${packageName})`);
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

  if (!(name in workspaceVersions)) {
    throw new Error(`Workspace package "${name}" (required by ${packageName}) was not found in the workspace`);
  }

  if (!RANGE_ONLY_SPECIFIERS.has(range)) {
    if (!range) {
      throw new Error(`Invalid workspace specifier "${specifier}" for "${name}" (required by ${packageName})`);
    }
    return range;
  }

  const version = workspaceVersions[name];
  if (!version) {
    throw new Error(`Workspace package "${name}" (required by ${packageName}) has no version in its package.json`);
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
