import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CATALOG_PREFIX = "catalog:";
const WORKSPACE_PREFIX = "workspace:";

const packages = Bun.argv.slice(2);

if (packages.length === 0) {
  console.error("No packages provided. Usage: bun ./prepare-publish.ts ./packages/hydra ./packages/sisyphus");
  process.exit(1);
}

async function loadRootPackageJson(packagePath: string) {
  let currentPath = resolve(packagePath);

  while (currentPath !== dirname(currentPath)) {
    const rootPkgPath = resolve(currentPath, "package.json");
    if (existsSync(rootPkgPath)) {
      const file = Bun.file(rootPkgPath);
      const rootPkg = await file.json();

      if (rootPkg.workspaces) {
        return rootPkg;
      }
    }
    currentPath = dirname(currentPath);
  }

  throw new Error("Could not find root package.json with workspaces");
}

function extractCatalogs(rootPkg: any) {
  const catalogs: Record<string, Record<string, string>> = { default: {} };

  if (rootPkg.catalog) {
    catalogs.default = rootPkg.catalog;
  }

  if (rootPkg.workspaces?.catalog) {
    catalogs.default = { ...catalogs.default, ...rootPkg.workspaces.catalog };
  }

  if (rootPkg.catalogs) {
    Object.assign(catalogs, rootPkg.catalogs);
  }

  if (rootPkg.workspaces?.catalogs) {
    Object.assign(catalogs, rootPkg.workspaces.catalogs);
  }

  return catalogs;
}

function resolveDependencies(
  deps: Record<string, string> | undefined,
  catalogs: Record<string, Record<string, string>>,
  packageName: string,
) {
  if (!deps) return deps;

  const resolved: Record<string, string> = {};

  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith(CATALOG_PREFIX)) {
      const catalogName = version.slice(CATALOG_PREFIX.length) || "default";
      const catalogVersion = catalogs[catalogName]?.[name];

      if (!catalogVersion) {
        throw new Error(`Catalog "${catalogName}" has no entry for "${name}" (required by ${packageName})`);
      }

      resolved[name] = catalogVersion;
    } else if (version.startsWith(WORKSPACE_PREFIX)) {
      resolved[name] = version;
    } else {
      resolved[name] = version;
    }
  }

  return resolved;
}

console.info(`Preparing ${packages.length} package${packages.length > 1 ? "s" : ""} for publish`);

const errors: Array<{ pkg: string; error: string }> = [];
let catalogs: Record<string, Record<string, string>> | null = null;

for (const pkg of packages) {
  const pkgPath = resolve(pkg);
  const pkgFilePath = `${pkgPath}/package.json`;

  try {
    if (!existsSync(pkgFilePath)) {
      errors.push({ error: `package.json not found at ${pkgFilePath}`, pkg });
      continue;
    }

    if (!catalogs) {
      const rootPkg = await loadRootPackageJson(pkgPath);
      catalogs = extractCatalogs(rootPkg);
    }

    const file = Bun.file(pkgFilePath);
    const { devDependencies: _, ...pkgJson } = await file.json();

    const resolvedPkg = {
      ...pkgJson,
      dependencies: resolveDependencies(pkgJson.dependencies, catalogs, pkgJson.name),
      optionalDependencies: resolveDependencies(pkgJson.optionalDependencies, catalogs, pkgJson.name),
      peerDependencies: resolveDependencies(pkgJson.peerDependencies, catalogs, pkgJson.name),
    };

    await Bun.write(pkgFilePath, `${JSON.stringify(resolvedPkg, null, 2)}\n`);
    console.info(`✅ Processed ${pkg}`);
  } catch (error) {
    errors.push({ error: error instanceof Error ? error.message : String(error), pkg });
  }
}

if (errors.length > 0) {
  console.error("\n❌ Errors occurred:");
  errors.forEach(({ pkg, error }) => {
    console.error(`  - ${pkg}: ${error}`);
  });
  process.exit(1);
}
