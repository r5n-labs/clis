import { VersionCalculator } from "../services/VersionCalculator";
import type { BumpType } from "./BumpType";

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
};

export class Package {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly dependencyOf: readonly string[];
  readonly bump?: BumpType;
  readonly tag?: string;

  constructor(options: PackageOptions) {
    this.name = options.name;
    this.version = options.version;
    this.file = options.file;
    this.dependencyOf = options.dependencyOf ?? [];
    this.bump = options.bump;
    this.tag = options.tag;
  }

  static fromJson(json: PackageJson, file: string): Package {
    return new Package({ file, name: json.name, version: json.version || "0.0.0" });
  }

  get newVersion(): string | undefined {
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
    return new Package({ ...this.toOptions(), bump, tag });
  }

  private toOptions(): PackageOptions {
    return {
      bump: this.bump,
      dependencyOf: this.dependencyOf,
      file: this.file,
      name: this.name,
      tag: this.tag,
      version: this.version,
    };
  }
}
