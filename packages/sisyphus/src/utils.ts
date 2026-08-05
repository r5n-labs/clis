import type { Package } from "./domain/Package";

export function buildPackagePathMap(packages: Map<string, Package>): Map<string, string> {
  const pathMap = new Map<string, string>();

  for (const [name, pkg] of packages) {
    const normalized = pkg.file.replace(/\\/g, "/");
    const dir = normalized.substring(0, normalized.lastIndexOf("/")) || ".";
    pathMap.set(dir, name);
  }

  return pathMap;
}

export function findAffectedPackages(
  files: string[],
  packagePaths: Map<string, string>,
  includeRoot = true,
): Set<string> {
  const affected = new Set<string>();

  for (const file of files) {
    for (const [dir, pkgName] of packagePaths) {
      const isRoot = dir === ".";
      const matchesPath = file.startsWith(`${dir}/`);

      if (isRoot ? includeRoot : matchesPath) {
        affected.add(pkgName);
      }
    }
  }

  return affected;
}
