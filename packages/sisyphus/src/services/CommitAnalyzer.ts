import type { ConfigManager } from "@r5n/cli-core";
import { COMMIT_TYPE_ORDER, COMMIT_TYPE_ORDER_FALLBACK } from "../constants";
import { BumpType, Commit, type CommitInfo, OTHER_COMMIT_TYPE } from "../domain";
import type { SisyphusConfig } from "../types";
import { buildPackagePathMap, findAffectedPackages } from "../utils";
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

    const trackedHashes = await this.stoneManager.getAllTrackedCommitHashes();
    if (trackedHashes.size > 0) {
      commits = commits.filter((c) => !trackedHashes.has(c.shortHash));
      if (commits.length === 0) return [];
    }

    return this.groupByPackage(commits, options);
  }

  get commitCount(): Promise<number> {
    return this.getCommitsSinceLastRelease().then((c) => c.length);
  }

  private async getCommitsSinceLastRelease(): Promise<Commit[]> {
    const lastStone = this.config.get("lastStone");
    const lastCommit = lastStone?.commit || undefined;
    return Commit.since(lastCommit);
  }

  private async groupByPackage(commits: Commit[], options: AnalyzeOptions): Promise<CommitGroup[]> {
    const { packages } = await WorkspaceScanner.scan({ filter: options.filter, single: options.single });
    const packagePaths = buildPackagePathMap(packages);
    const typeGroups = new Map<string, CommitGroup>();

    for (const commit of commits) {
      const affectedPackages = findAffectedPackages(commit.files, packagePaths);
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
      .filter(([, g]) => g.packages.size > 0)
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
}
