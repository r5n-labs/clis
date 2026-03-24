import { DEFAULT_VERSION } from "../constants";
import { VersionCalculator } from "../services/VersionCalculator";
import { BUMP_ORDER, type BumpType } from "./BumpType";
import type { Stone } from "./Stone";

export type PackageJson = {
  name: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type PackageOptions = {
  name: string;
  version: string;
  file: string;
  dependencyOf?: readonly string[];
  bump?: BumpType;
  tag?: string;
  newVersion?: string;
};

export class Package {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly dependencyOf: readonly string[];
  readonly bump?: BumpType;
  readonly tag?: string;
  private readonly _newVersion?: string;

  constructor(options: PackageOptions) {
    this.name = options.name;
    this.version = options.version;
    this.file = options.file;
    this.dependencyOf = options.dependencyOf ?? [];
    this.bump = options.bump;
    this.tag = options.tag;
    this._newVersion = options.newVersion;
  }

  static fromJson(json: PackageJson, file: string): Package {
    return new Package({ file, name: json.name, version: json.version || DEFAULT_VERSION });
  }

  static applyStone(stone: Stone, packages: Map<string, Package>): Package[] {
    const updated: Package[] = [];

    for (const bump of BUMP_ORDER) {
      for (const name of stone.getPackages(bump)) {
        const pkg = packages.get(name);
        if (pkg) {
          updated.push(pkg.withBump(bump, stone.tag));
        }
      }
    }

    return updated;
  }

  get newVersion(): string | undefined {
    if (this._newVersion) return this._newVersion;
    if (!this.bump) return undefined;
    return VersionCalculator.bump(this.version, this.bump, this.tag);
  }

  get label(): string {
    if (!this.bump) return `${this.name}@${this.version}`;
    return VersionCalculator.formatLabel(this.name, this.version, this.bump, this.tag);
  }

  withDependencyOf(dependencyOf: readonly string[]): Package {
    return new Package({ ...this.toOptions(), dependencyOf });
  }

  withBump(bump: BumpType, tag?: string): Package {
    return new Package({ ...this.toOptions(), bump, newVersion: undefined, tag });
  }

  withVersions(oldVersion: string, newVersion: string): Package {
    return new Package({ ...this.toOptions(), newVersion, version: oldVersion });
  }

  private toOptions(): PackageOptions {
    return {
      bump: this.bump,
      dependencyOf: this.dependencyOf,
      file: this.file,
      name: this.name,
      newVersion: this._newVersion,
      tag: this.tag,
      version: this.version,
    };
  }
}
