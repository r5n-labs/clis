import { DEFAULT_VERSION } from "../constants";
import { VersionCalculator } from "../services/VersionCalculator";
import type { DependencyKind } from "../types";
import { BUMP_ORDER, BumpType } from "./BumpType";
import type { Stone } from "./Stone";
import { isPrerelease, parseSemver, type Semver } from "./semver";

const EMPTY_SEMVER: Semver = { build: [], major: 0, minor: 0, patch: 0, prerelease: [] };

export const WORKSPACE_PREFIX = "workspace:";

export const DEPENDENCY_KINDS: readonly DependencyKind[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export type WorkspaceDependency = { name: string; kind: DependencyKind; specifier: string };

export type PackageJson = {
  name: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export type PackageOptions = {
  name: string;
  version: string;
  file: string;
  workspaceDependencies?: readonly WorkspaceDependency[];
  bump?: BumpType;
  tag?: string;
  newVersion?: string;
  isPrivate?: boolean;
};

export function collectWorkspaceDependencies(json: PackageJson): WorkspaceDependency[] {
  const dependencies: WorkspaceDependency[] = [];

  for (const kind of DEPENDENCY_KINDS) {
    for (const [name, specifier] of Object.entries(json[kind] ?? {})) {
      if (!specifier?.startsWith(WORKSPACE_PREFIX)) continue;
      dependencies.push({ kind, name, specifier });
    }
  }

  return dependencies;
}

export class Package {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly workspaceDependencies: readonly WorkspaceDependency[];
  readonly bump?: BumpType;
  readonly tag?: string;
  readonly isPrivate: boolean;
  private readonly _newVersion?: string;

  constructor(options: PackageOptions) {
    this.name = options.name;
    this.version = options.version;
    this.file = options.file;
    this.workspaceDependencies = options.workspaceDependencies ?? [];
    this.bump = options.bump;
    this.tag = options.tag;
    this.isPrivate = options.isPrivate ?? false;
    this._newVersion = options.newVersion;
  }

  static fromJson(json: PackageJson, file: string): Package {
    return new Package({
      file,
      isPrivate: json.private ?? false,
      name: json.name,
      version: json.version || DEFAULT_VERSION,
      workspaceDependencies: collectWorkspaceDependencies(json),
    });
  }

  static applyStone(stone: Stone, packages: Map<string, Package>): Package[] {
    const updated: Package[] = [];
    const seen = new Set<string>();
    const graduating = Package.graduatingPackages(stone, packages);

    for (const bump of BUMP_ORDER) {
      for (const name of stone.getPackages(bump)) {
        const pkg = packages.get(name);
        if (!pkg || seen.has(name)) continue;
        seen.add(name);
        updated.push(pkg.withBump(bump, stone.tag, graduating.has(name)));
      }
    }

    return updated;
  }

  private static graduatingPackages(stone: Stone, packages: Map<string, Package>): ReadonlySet<string> {
    const graduating = new Set<string>();
    if (stone.tag !== undefined) return graduating;

    const explicitBumps = BUMP_ORDER.filter((bump) => bump !== BumpType.Dependency && bump !== BumpType.Snapshot);
    for (const bump of explicitBumps) {
      for (const name of stone.getPackages(bump)) {
        if (Package.isPrereleaseVersion(packages.get(name)?.version)) graduating.add(name);
      }
    }

    const candidates = stone
      .getPackages(BumpType.Dependency)
      .map((name) => packages.get(name))
      .filter((pkg): pkg is Package => pkg !== undefined && Package.isPrereleaseVersion(pkg.version));

    let changed = true;
    while (changed) {
      changed = false;

      for (const pkg of candidates) {
        if (graduating.has(pkg.name)) continue;
        if (!pkg.workspaceDependencies.some((dependency) => graduating.has(dependency.name))) continue;

        graduating.add(pkg.name);
        changed = true;
      }
    }

    return graduating;
  }

  private static isPrereleaseVersion(version: string | undefined): boolean {
    return version !== undefined && isPrerelease(parseSemver(version) ?? EMPTY_SEMVER);
  }

  get newVersion(): string | undefined {
    if (this._newVersion) return this._newVersion;
    if (!this.bump) return undefined;
    return VersionCalculator.bump(this.version, this.bump, this.tag);
  }

  get label(): string {
    if (!this.bump) return `${this.name}@${this.version}`;
    return VersionCalculator.formatLabel(this.name, this.version, this.bump, this.tag, this._newVersion);
  }

  withBump(bump: BumpType, tag?: string, graduating = false): Package {
    return new Package({
      ...this.toOptions(),
      bump,
      newVersion: VersionCalculator.bump(this.version, bump, tag, graduating),
      tag,
    });
  }

  withVersions(oldVersion: string, newVersion: string): Package {
    return new Package({ ...this.toOptions(), newVersion, version: oldVersion });
  }

  private toOptions(): PackageOptions {
    return {
      bump: this.bump,
      file: this.file,
      isPrivate: this.isPrivate,
      name: this.name,
      newVersion: this._newVersion,
      tag: this.tag,
      version: this.version,
      workspaceDependencies: this.workspaceDependencies,
    };
  }
}
