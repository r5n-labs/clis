import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CatalogMap, PackageManifest, RootManifest, WorkspaceVersionMap } from "./publish-manifest";
import { createPublishManifest, extractCatalogs, extractWorkspaceGlobs } from "./publish-manifest";

const JSON_INDENT = 2;

const packages = Bun.argv.slice(2);

if (packages.length === 0) {
  console.error("No packages provided. Usage: bun ./prepare-publish.ts ./packages/hydra ./packages/sisyphus");
  process.exit(1);
}

async function loadRootPackage(packagePath: string): Promise<{ rootDir: string; rootPkg: RootManifest }> {
  let currentPath = resolve(packagePath);

  while (currentPath !== dirname(currentPath)) {
    const rootPkgPath = resolve(currentPath, "package.json");
    if (existsSync(rootPkgPath)) {
      const rootPkg = (await Bun.file(rootPkgPath).json()) as RootManifest;

      if (rootPkg.workspaces) {
        return { rootDir: currentPath, rootPkg };
      }
    }
    currentPath = dirname(currentPath);
  }

  throw new Error("Could not find root package.json with workspaces");
}

async function collectWorkspaceVersions(rootDir: string, rootPkg: RootManifest): Promise<WorkspaceVersionMap> {
  const versions: WorkspaceVersionMap = {};

  for (const workspaceGlob of extractWorkspaceGlobs(rootPkg)) {
    const glob = new Bun.Glob(`${workspaceGlob}/package.json`);

    for await (const match of glob.scan({ cwd: rootDir })) {
      const manifest = (await Bun.file(resolve(rootDir, match)).json()) as PackageManifest;
      if (!manifest.name) continue;
      versions[manifest.name] = { isPrivate: manifest.private === true, version: manifest.version ?? null };
    }
  }

  return versions;
}

console.info(`Preparing ${packages.length} package${packages.length > 1 ? "s" : ""} for publish`);

const errors: Array<{ pkg: string; error: string }> = [];
let catalogs: CatalogMap | null = null;
let workspaceVersions: WorkspaceVersionMap | null = null;

for (const pkg of packages) {
  const pkgPath = resolve(pkg);
  const pkgFilePath = `${pkgPath}/package.json`;

  try {
    if (!existsSync(pkgFilePath)) {
      errors.push({ error: `package.json not found at ${pkgFilePath}`, pkg });
      continue;
    }

    if (!catalogs || !workspaceVersions) {
      const { rootDir, rootPkg } = await loadRootPackage(pkgPath);
      catalogs = extractCatalogs(rootPkg);
      workspaceVersions = await collectWorkspaceVersions(rootDir, rootPkg);
    }

    const manifest = (await Bun.file(pkgFilePath).json()) as PackageManifest;
    const publishManifest = createPublishManifest(manifest, catalogs, workspaceVersions);

    await Bun.write(pkgFilePath, `${JSON.stringify(publishManifest, null, JSON_INDENT)}\n`);
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
