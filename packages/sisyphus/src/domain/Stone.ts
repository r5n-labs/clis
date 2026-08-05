import { randomUUID } from "node:crypto";
import { Exit } from "@r5n/cli-core";
import { SHORT_UUID_LENGTH, STONE_ID_PAD_LENGTH } from "../constants";
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

export type MergeResult = { stone: Stone; conflicts: readonly string[]; errors: readonly string[] };

type StoneOptions = {
  id: string;
  message: string;
  packages: Map<BumpType, readonly string[]>;
  tag?: string;
  description?: string;
  commits?: readonly CommitInfo[];
};

export class Stone {
  readonly id: string;
  readonly message: string;
  readonly tag?: string;
  readonly description?: string;
  readonly commits?: readonly CommitInfo[];

  private readonly _packages: ReadonlyMap<BumpType, readonly string[]>;

  private constructor(options: StoneOptions) {
    this.id = options.id;
    this.message = options.message;
    this.tag = options.tag;
    this.description = options.description;
    this.commits = options.commits;
    this._packages = options.packages;
  }

  static create(data: StoneData, existingCount = 0): Stone {
    const id = Stone.generateId(existingCount);
    return Stone.fromData(id, data);
  }

  static fromJson(json: StoneJson): Stone {
    return Stone.fromData(json.id, json);
  }

  static mergeAll(stones: Stone[]): Stone {
    if (stones.length === 0) throw new Error("No stones to merge");

    const messages = stones.map((s) => s.message).join("; ");
    const { stone, errors } = Stone.merge(stones, messages);
    if (errors.length > 0) {
      throw new Exit("Pending stones conflict and cannot be released together", errors.join("\n"));
    }

    return stone;
  }

  static merge(stones: Stone[], message: string): MergeResult {
    const packageBumps = new Map<string, BumpType>();
    const conflicts: string[] = [];
    const errors: string[] = [];

    for (const stone of stones) {
      for (const bump of BUMP_ORDER) {
        Stone.collectBumps(stone, bump, packageBumps, conflicts, errors);
      }
    }

    const packages = Stone.categorizeBumps(packageBumps);
    const descriptions = stones
      .map((s) => s.description)
      .filter(Boolean)
      .join("\n\n");
    const commits = Stone.mergeCommits(stones);
    const tag = Stone.resolveTag(stones, errors);

    const id = `merged-${Date.now()}`;
    const stone = new Stone({
      commits: commits.length > 0 ? commits : undefined,
      description: descriptions || undefined,
      id,
      message,
      packages,
      tag,
    });

    return { conflicts: [...new Set(conflicts)], errors: [...new Set(errors)], stone };
  }

  private static resolveTag(allStones: Stone[], errors: string[]): string | undefined {
    const stones = allStones.filter((stone) => !stone.isEmpty);
    const tagged = new Map<string, string[]>();
    for (const stone of stones) {
      if (!stone.tag) continue;
      tagged.set(stone.tag, [...(tagged.get(stone.tag) ?? []), stone.id]);
    }

    if (tagged.size === 0) return undefined;

    const untagged = stones.filter((stone) => !stone.tag).map((stone) => stone.id);
    if (tagged.size > 1 || untagged.length > 0) {
      const described = [...tagged.entries()].map(([tag, ids]) => `${tag}: ${ids.join(", ")}`);
      if (untagged.length > 0) described.push(`no tag: ${untagged.join(", ")}`);
      errors.push(`Stones disagree on the prerelease tag (${described.join("; ")})`);
    }

    return [...tagged.keys()][0];
  }

  private static mergeCommits(stones: Stone[]): CommitInfo[] {
    const byHash = new Map<string, CommitInfo>();

    for (const commit of stones.flatMap((stone) => stone.commits ?? [])) {
      const existing = byHash.get(commit.hash);
      if (!existing) {
        byHash.set(commit.hash, { ...commit, packages: [...(commit.packages ?? [])] });
        continue;
      }

      const packages = new Set([...existing.packages, ...(commit.packages ?? [])]);
      byHash.set(commit.hash, { ...existing, packages: [...packages] });
    }

    return [...byHash.values()];
  }

  private static collectBumps(
    stone: Stone,
    bump: BumpType,
    packageBumps: Map<string, BumpType>,
    conflicts: string[],
    errors: string[],
  ): void {
    for (const pkg of stone.getPackages(bump)) {
      const currentBump = packageBumps.get(pkg);

      if (!currentBump) {
        packageBumps.set(pkg, bump);
        continue;
      }

      if (currentBump === bump) continue;

      if (currentBump === BumpType.Snapshot || bump === BumpType.Snapshot) {
        errors.push(
          `Package ${pkg} is requested as both a snapshot and a ${currentBump === BumpType.Snapshot ? bump : currentBump} release`,
        );
        continue;
      }

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

    return new Stone({
      commits: data.commits,
      description: data.description,
      id,
      message: data.message,
      packages,
      tag: data.tag,
    });
  }

  private static generateId(existingCount: number): string {
    const paddedNumber = String(existingCount + 1).padStart(STONE_ID_PAD_LENGTH, "0");
    const shortUuid = randomUUID().slice(0, SHORT_UUID_LENGTH);
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

  affectsPackage(packageName: string): boolean {
    return this.allPackages.includes(packageName);
  }

  getPackages(bump: BumpType): readonly string[] {
    return this._packages.get(bump) ?? [];
  }

  withMessage(message: string): Stone {
    return new Stone({ ...this.toOptions(), message });
  }

  withTag(tag: string | undefined): Stone {
    return new Stone({ ...this.toOptions(), tag });
  }

  withDescription(description: string | undefined): Stone {
    return new Stone({ ...this.toOptions(), description });
  }

  withCommits(commits: readonly CommitInfo[] | undefined): Stone {
    return new Stone({ ...this.toOptions(), commits });
  }

  withPackages(bump: BumpType, packages: readonly string[]): Stone {
    const newPackages = new Map(this._packages);
    newPackages.set(bump, packages);
    return new Stone({ ...this.toOptions(), packages: newPackages });
  }

  private toOptions(): StoneOptions {
    return {
      commits: this.commits,
      description: this.description,
      id: this.id,
      message: this.message,
      packages: new Map(this._packages),
      tag: this.tag,
    };
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
