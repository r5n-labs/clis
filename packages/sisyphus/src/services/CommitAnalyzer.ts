import { type ConfigManager, color, log } from "@r5n/cli-core";
import { COMMIT_TYPE_ORDER, COMMIT_TYPE_ORDER_FALLBACK, SISYPHUS_DEFAULT_CONFIG } from "../constants";
import {
  BumpType,
  Commit,
  type CommitInfo,
  nonEmpty,
  OTHER_COMMIT_TYPE,
  type Package,
  type StoneData,
} from "../domain";
import type { CommitsSkipConfig, SisyphusConfig } from "../types";
import { buildPackagePathMap, findAffectedPackages, findDependencyPackages } from "../utils";
import { StoneManager } from "./StoneManager";
import { WorkspaceScanner } from "./WorkspaceScanner";

const COMMIT_TYPE_TO_BUMP: Record<string, BumpType> = {
  build: BumpType.Patch,
  chore: BumpType.Patch,
  ci: BumpType.Patch,
  docs: BumpType.Patch,
  feat: BumpType.Minor,
  fix: BumpType.Patch,
  perf: BumpType.Patch,
  refactor: BumpType.Patch,
  style: BumpType.Patch,
  test: BumpType.Patch,
  [OTHER_COMMIT_TYPE]: BumpType.Patch,
};

export type CommitGroup = { message: string; bump: BumpType; packages: Set<string>; commits: CommitInfo[] };

export type AnalyzeOptions = { filter?: string; single?: boolean };

export class CommitAnalyzer {
  private stoneManager: StoneManager;

  constructor(private config: ConfigManager<SisyphusConfig>) {
    this.stoneManager = new StoneManager(config);
  }

  async analyze(options: AnalyzeOptions = {}): Promise<CommitGroup[]> {
    let commits = await this.getCommitsSinceLastRelease();
    if (commits.length === 0) return [];

    const skipConfig = this.config.get("commits")?.skip ?? SISYPHUS_DEFAULT_CONFIG.commits.skip;
    commits = commits.filter((c) => !this.shouldSkipCommit(c, skipConfig));
    if (commits.length === 0) return [];

    const trackedPackages = await this.stoneManager.getTrackedCommitPackages();
    return this.groupByPackage(commits, options, trackedPackages);
  }

  private shouldSkipCommit(commit: Commit, skip: CommitsSkipConfig): boolean {
    if (skip.authors.includes(commit.author)) return true;

    for (const pattern of skip.messagePatterns) {
      try {
        if (new RegExp(pattern, "i").test(commit.subject)) return true;
      } catch {
        log.warn(color.yellow(`Invalid regex pattern in commits.skip.messagePatterns: "${pattern}"`));
      }
    }

    return false;
  }

  private async getCommitsSinceLastRelease(): Promise<Commit[]> {
    const lastStone = this.config.get("lastStone");
    const lastCommit = lastStone?.commit || undefined;
    if (!lastCommit) return [];
    return Commit.since(lastCommit);
  }

  private async groupByPackage(
    commits: Commit[],
    options: AnalyzeOptions,
    trackedPackages: Map<string, Set<string>>,
  ): Promise<CommitGroup[]> {
    const { packages, packageNames } = await WorkspaceScanner.scan({ filter: options.filter, single: options.single });
    const names = new Set(packageNames);
    const filteredPackages = new Map([...packages].filter(([name]) => names.has(name)));
    const packagePaths = buildPackagePathMap(filteredPackages);
    const typeGroups = new Map<string, CommitGroup>();

    for (const commit of commits) {
      const affectedPackages = findAffectedPackages(commit.files, packagePaths);
      for (const covered of trackedPackages.get(commit.shortHash) ?? []) {
        affectedPackages.delete(covered);
      }
      if (affectedPackages.size === 0) continue;

      const bump = commit.breaking ? BumpType.Major : COMMIT_TYPE_TO_BUMP[commit.type] || BumpType.Patch;
      const groupKey = `${commit.type}${commit.breaking ? "!" : ""}`;

      let group = typeGroups.get(groupKey);
      if (!group) {
        const groupMessage = this.getGroupMessage(commit);
        group = { bump, commits: [], message: groupMessage, packages: new Set() };
        typeGroups.set(groupKey, group);
      }

      group.commits.push(commit.toInfo([...affectedPackages]));

      for (const pkg of affectedPackages) {
        group.packages.add(pkg);
      }
    }

    return Array.from(typeGroups.entries())
      .sort(
        ([a], [b]) =>
          (COMMIT_TYPE_ORDER[a] ?? COMMIT_TYPE_ORDER_FALLBACK) - (COMMIT_TYPE_ORDER[b] ?? COMMIT_TYPE_ORDER_FALLBACK),
      )
      .map(([, g]) => g);
  }

  private getGroupMessage(commit: Commit): string {
    const sections = this.config.get("changelog").sections;
    if (commit.breaking) return sections.breaking;
    return sections[commit.type as keyof typeof sections] ?? `${commit.type} updates`;
  }

  static buildStoneData(group: CommitGroup, packages: Map<string, Package>, tag?: string): StoneData {
    const pkgNames = Array.from(group.packages);

    return {
      [group.bump]: pkgNames,
      commits: nonEmpty(group.commits),
      dependency: nonEmpty(findDependencyPackages(pkgNames, packages)),
      message: group.message,
      tag,
    };
  }
}
