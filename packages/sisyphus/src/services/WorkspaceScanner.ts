import { Exit } from "@r5n/cli-core";
import { Package, type PackageJson } from "../domain";

export type ScanOptions = { filter?: string; single?: boolean };

export type ScanResult = { packages: Map<string, Package>; packageNames: readonly string[] };

export class WorkspaceScanner {
  static async scan(options: ScanOptions = {}): Promise<ScanResult> {
    const { filter, single } = options;

    if (single) {
      return WorkspaceScanner.scanRootPackage();
    }

    const workspaces = await WorkspaceScanner.getWorkspaces();
    WorkspaceScanner.validateWorkspaces(workspaces);

    const packages = await WorkspaceScanner.scanWorkspaces(workspaces);
    const packageNames = WorkspaceScanner.filterNames(Array.from(packages.keys()), filter);

    return { packageNames, packages };
  }

  private static async getWorkspaces(): Promise<string[]> {
    try {
      const rootPkg = await Bun.file("package.json").json();
      const config = rootPkg?.workspaces;

      if (Array.isArray(config)) return config;
      return config?.packages || [];
    } catch {
      throw new Exit("Could not read package.json", "Ensure you're in a project root directory.");
    }
  }

  private static validateWorkspaces(workspaces: string[]): void {
    if (workspaces.length === 0) {
      throw new Exit(
        "No workspaces found in package.json.",
        "Use --single flag or set `single: true` in config for single-package mode.",
      );
    }
  }

  private static filterNames(names: string[], filter?: string): readonly string[] {
    if (!filter) return names;
    return names.filter((name) => name.includes(filter));
  }

  private static async scanRootPackage(): Promise<ScanResult> {
    const json: PackageJson = await Bun.file("package.json").json();
    const pkg = Package.fromJson(json, "package.json");

    const packages = new Map<string, Package>();
    packages.set(pkg.name, pkg);

    return { packageNames: [pkg.name], packages };
  }

  private static async scanWorkspaces(workspaces: string[]): Promise<Map<string, Package>> {
    const packages = new Map<string, Package>();
    const dependencyOf = new Map<string, string[]>();

    for (const workspace of workspaces) {
      const files = new Bun.Glob(`${workspace}/package.json`).scanSync({ cwd: process.cwd() });

      for (const file of files) {
        const pkg = await WorkspaceScanner.processPackageFile(file, dependencyOf);
        if (pkg) {
          packages.set(pkg.name, pkg);
        }
      }
    }

    WorkspaceScanner.linkDependencies(packages, dependencyOf);
    return packages;
  }

  private static async processPackageFile(file: string, dependencyOf: Map<string, string[]>): Promise<Package> {
    const json: PackageJson = await Bun.file(file).json();
    const pkg = Package.fromJson(json, file);

    WorkspaceScanner.trackDependencies(pkg.name, json, dependencyOf);

    return pkg;
  }

  private static trackDependencies(packageName: string, json: PackageJson, dependencyOf: Map<string, string[]>): void {
    const deps = { ...json.dependencies, ...json.devDependencies };

    for (const [depName, depVersion] of Object.entries(deps)) {
      if (!depVersion?.startsWith("workspace")) continue;

      const existing = dependencyOf.get(depName) || [];
      if (!existing.includes(packageName)) {
        dependencyOf.set(depName, [...existing, packageName]);
      }
    }
  }

  private static linkDependencies(packages: Map<string, Package>, dependencyOf: Map<string, string[]>): void {
    for (const [pkgName, deps] of dependencyOf) {
      const pkg = packages.get(pkgName);
      if (pkg) {
        packages.set(pkgName, pkg.withDependencyOf(deps));
      }
    }
  }
}
