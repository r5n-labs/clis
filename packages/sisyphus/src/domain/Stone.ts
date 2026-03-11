import { randomUUID } from "node:crypto";
import { BUMP_ORDER, BumpType, higherBump } from "./BumpType";
import type { CommitInfo } from "./Commit";
import { nonEmpty } from "./helpers";

export type StoneData = {
  message: string;
  tag?: string;
  description?: string;
  commits?: readonly CommitInfo[];
  major?: readonly string[];
  minor?: readonly string[];
  patch?: readonly string[];
  dependency?: readonly string[];
  snapshot?: readonly string[];
};

export type StoneJson = StoneData & { id: string; commits?: readonly CommitInfo[] };

export type MergeResult = { stone: Stone; conflicts: readonly string[] };

export class Stone {
  readonly id: string;
  readonly message: string;
  readonly tag?: string;
  readonly description?: string;
  readonly commits?: readonly CommitInfo[];

  private readonly _packages: ReadonlyMap<BumpType, readonly string[]>;

  private constructor(
    id: string,
    message: string,
    packages: Map<BumpType, readonly string[]>,
    tag?: string,
    description?: string,
    commits?: readonly CommitInfo[],
  ) {
    this.id = id;
    this.message = message;
    this.tag = tag;
    this.description = description;
    this.commits = commits;
    this._packages = packages;
  }

  static create(data: StoneData, existingCount = 0): Stone {
    const id = Stone.generateId(existingCount);
    return Stone.fromData(id, data);
  }

  static fromJson(json: StoneJson): Stone {
    return Stone.fromData(json.id, json);
  }

  static mergeAll(stones: Stone[]): Stone {
    const [first, ...rest] = stones;
    if (!first) throw new Error("No stones to merge");
    if (rest.length === 0) return first;

    const messages = stones.map((s) => s.message).join("; ");
    return Stone.merge(stones, messages).stone;
  }

  static merge(stones: Stone[], message: string): MergeResult {
    const packageBumps = new Map<string, BumpType>();
    const conflicts: string[] = [];

    for (const stone of stones) {
      Stone.collectBumps(stone, BumpType.Major, packageBumps, conflicts);
      Stone.collectBumps(stone, BumpType.Minor, packageBumps, conflicts);
      Stone.collectBumps(stone, BumpType.Patch, packageBumps, conflicts);
      Stone.collectBumps(stone, BumpType.Dependency, packageBumps, conflicts);
    }

    const packages = Stone.categorizeBumps(packageBumps);
    const descriptions = stones
      .map((s) => s.description)
      .filter(Boolean)
      .join("\n\n");
    const commits = stones.flatMap((s) => s.commits ?? []);
    const tags = [...new Set(stones.map((s) => s.tag).filter(Boolean))];

    const id = `merged-${Date.now()}`;
    const stone = new Stone(
      id,
      message,
      packages,
      tags[0],
      descriptions || undefined,
      commits.length > 0 ? commits : undefined,
    );

    return { conflicts: [...new Set(conflicts)], stone };
  }

  private static collectBumps(
    stone: Stone,
    bump: BumpType,
    packageBumps: Map<string, BumpType>,
    conflicts: string[],
  ): void {
    for (const pkg of stone.getPackages(bump)) {
      const currentBump = packageBumps.get(pkg);

      if (!currentBump) {
        packageBumps.set(pkg, bump);
        continue;
      }

      if (currentBump === bump) continue;

      conflicts.push(pkg);
      const resolved = higherBump(bump, currentBump);
      if (resolved !== currentBump) packageBumps.set(pkg, resolved);
    }
  }

  private static categorizeBumps(packageBumps: Map<string, BumpType>): Map<BumpType, readonly string[]> {
    const result = new Map<BumpType, string[]>();

    for (const bump of BUMP_ORDER) {
      result.set(bump, []);
    }

    for (const [pkg, bump] of packageBumps) {
      result.get(bump)?.push(pkg);
    }

    return result as Map<BumpType, readonly string[]>;
  }

  private static fromData(id: string, data: StoneData): Stone {
    const packages = new Map<BumpType, readonly string[]>();
    packages.set(BumpType.Major, data.major ?? []);
    packages.set(BumpType.Minor, data.minor ?? []);
    packages.set(BumpType.Patch, data.patch ?? []);
    packages.set(BumpType.Dependency, data.dependency ?? []);
    packages.set(BumpType.Snapshot, data.snapshot ?? []);

    return new Stone(id, data.message, packages, data.tag, data.description, data.commits);
  }

  private static generateId(existingCount: number): string {
    const paddedNumber = String(existingCount + 1).padStart(4, "0");
    const shortUuid = randomUUID().slice(0, 8);
    return `${paddedNumber}-${shortUuid}`;
  }

  get major(): readonly string[] {
    return this._packages.get(BumpType.Major) ?? [];
  }

  get minor(): readonly string[] {
    return this._packages.get(BumpType.Minor) ?? [];
  }

  get patch(): readonly string[] {
    return this._packages.get(BumpType.Patch) ?? [];
  }

  get dependency(): readonly string[] {
    return this._packages.get(BumpType.Dependency) ?? [];
  }

  get snapshot(): readonly string[] {
    return this._packages.get(BumpType.Snapshot) ?? [];
  }

  get allPackages(): readonly string[] {
    const all: string[] = [];
    for (const packages of this._packages.values()) {
      all.push(...packages);
    }
    return all;
  }

  get isEmpty(): boolean {
    return this.allPackages.length === 0;
  }

  getPackages(bump: BumpType): readonly string[] {
    return this._packages.get(bump) ?? [];
  }

  withMessage(message: string): Stone {
    return new Stone(this.id, message, new Map(this._packages), this.tag, this.description, this.commits);
  }

  withTag(tag: string | undefined): Stone {
    return new Stone(this.id, this.message, new Map(this._packages), tag, this.description, this.commits);
  }

  withDescription(description: string | undefined): Stone {
    return new Stone(this.id, this.message, new Map(this._packages), this.tag, description, this.commits);
  }

  withCommits(commits: readonly CommitInfo[] | undefined): Stone {
    return new Stone(this.id, this.message, new Map(this._packages), this.tag, this.description, commits);
  }

  withPackages(bump: BumpType, packages: readonly string[]): Stone {
    const newPackages = new Map(this._packages);
    newPackages.set(bump, packages);
    return new Stone(this.id, this.message, newPackages, this.tag, this.description, this.commits);
  }

  toJson(): StoneJson {
    return {
      commits: this.commits && this.commits.length > 0 ? this.commits : undefined,
      dependency: nonEmpty(this.dependency),
      description: this.description,
      id: this.id,
      major: nonEmpty(this.major),
      message: this.message,
      minor: nonEmpty(this.minor),
      patch: nonEmpty(this.patch),
      snapshot: nonEmpty(this.snapshot),
      tag: this.tag,
    };
  }
}
