import type { ConfigManager } from "@r5n/cli-core";
import { BumpType, type CommitInfo, type Package } from "../domain";
import type { SisyphusConfig } from "../types";
import { WorkspaceScanner } from "./WorkspaceScanner";

const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;

const OTHER_COMMIT_TYPE = "other";

const GROUP_ORDER: Record<string, number> = {
  build: 23,
  chore: 25,
  ci: 24,
  docs: 20,
  feat: 10,
  "feat!": 0,
  fix: 11,
  "fix!": 1,
  perf: 12,
  refactor: 13,
  style: 21,
  test: 22,
  [OTHER_COMMIT_TYPE]: 100,
};

const FALLBACK_ORDER = 50;

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

type ParsedCommit = {
  hash: string;
  subject: string;
  body?: string;
  type: string;
  scope?: string;
  breaking: boolean;
  message: string;
  files: string[];
};

export type CommitGroup = { message: string; bump: BumpType; packages: Set<string>; commits: CommitInfo[] };

export type AnalyzeOptions = { filter?: string; single?: boolean };

export class CommitAnalyzer {
  constructor(private config: ConfigManager<SisyphusConfig>) {}

  async analyze(options: AnalyzeOptions = {}): Promise<CommitGroup[]> {
    const commits = await this.getCommitsSinceLastRelease();
    if (commits.length === 0) return [];

    const parsed = await this.parseCommits(commits);
    if (parsed.length === 0) return [];

    return this.groupByPackage(parsed, options);
  }

  get commitCount(): Promise<number> {
    return this.getCommitsSinceLastRelease().then((c) => c.length);
  }

  private async getCommitsSinceLastRelease(): Promise<string[]> {
    const lastStone = this.config.get("lastStone");
    const lastCommit = lastStone?.commit || "";
    const range = lastCommit ? `${lastCommit}..HEAD` : "HEAD";

    const result = await Bun.$`git log ${range} --pretty=format:"%H|%s" --no-merges`.quiet();
    const output = result.stdout.toString().trim();

    if (!output) return [];
    return output.split("\n");
  }

  private async parseCommits(commits: string[]): Promise<ParsedCommit[]> {
    const parsed: ParsedCommit[] = [];

    for (const commit of commits) {
      const [hash, subject] = commit.split("|");
      if (!hash || !subject) continue;

      const result = this.parseCommit(hash, subject);
      result.files = await this.getCommitFiles(hash);
      result.body = await this.getCommitBody(hash);
      parsed.push(result);
    }

    return parsed;
  }

  private parseCommit(hash: string, subject: string): ParsedCommit {
    const match = subject.match(CONVENTIONAL_COMMIT_REGEX);

    if (match) {
      const [, type = "", scope, breaking, message = ""] = match;
      if (type && COMMIT_TYPE_TO_BUMP[type]) {
        return { breaking: !!breaking, files: [], hash, message, scope, subject, type };
      }
    }

    return { breaking: false, files: [], hash, message: subject, subject, type: OTHER_COMMIT_TYPE };
  }

  private async getCommitFiles(hash: string): Promise<string[]> {
    const result = await Bun.$`git diff-tree --no-commit-id --name-only -r ${hash}`.quiet();
    return result.stdout.toString().trim().split("\n").filter(Boolean);
  }

  private async getCommitBody(hash: string): Promise<string | undefined> {
    const result = await Bun.$`git log -1 --pretty=format:"%b" ${hash}`.quiet();
    const body = result.stdout.toString().trim();
    return body || undefined;
  }

  private async groupByPackage(commits: ParsedCommit[], options: AnalyzeOptions): Promise<CommitGroup[]> {
    const { packages } = await WorkspaceScanner.scan({ filter: options.filter, single: options.single });
    const packagePaths = this.buildPackagePathMap(packages);
    const typeGroups = new Map<string, CommitGroup>();

    for (const commit of commits) {
      const affectedPackages = this.findAffectedPackages(commit.files, packagePaths);
      if (affectedPackages.size === 0) continue;

      const bump = commit.breaking ? BumpType.Major : COMMIT_TYPE_TO_BUMP[commit.type] || BumpType.Patch;
      const groupKey = `${commit.type}${commit.breaking ? "!" : ""}`;

      let group = typeGroups.get(groupKey);
      if (!group) {
        const groupMessage = this.getGroupMessage(commit);
        group = { bump, commits: [], message: groupMessage, packages: new Set() };
        typeGroups.set(groupKey, group);
      }

      group.commits.push({
        body: commit.body,
        hash: commit.hash.slice(0, 7),
        message: commit.message,
        packages: [...affectedPackages],
        scope: commit.scope,
        subject: commit.subject,
        type: commit.type,
      });

      for (const pkg of affectedPackages) {
        group.packages.add(pkg);
      }
    }

    return Array.from(typeGroups.entries())
      .filter(([, g]) => g.packages.size > 0)
      .sort(([a], [b]) => (GROUP_ORDER[a] ?? FALLBACK_ORDER) - (GROUP_ORDER[b] ?? FALLBACK_ORDER))
      .map(([, g]) => g);
  }

  private getGroupMessage(commit: ParsedCommit): string {
    const sections = this.config.get("changelog").sections;
    if (commit.breaking) return sections.breaking;
    return sections[commit.type as keyof typeof sections] ?? `${commit.type} updates`;
  }

  private buildPackagePathMap(packages: Map<string, Package>): Map<string, string> {
    const pathMap = new Map<string, string>();

    for (const [name, pkg] of packages) {
      const normalized = pkg.file.replace(/\\/g, "/");
      const dir = normalized.substring(0, normalized.lastIndexOf("/")) || ".";
      pathMap.set(dir, name);
    }

    return pathMap;
  }

  private findAffectedPackages(files: string[], packagePaths: Map<string, string>): Set<string> {
    const affected = new Set<string>();

    for (const file of files) {
      for (const [dir, pkgName] of packagePaths) {
        if (dir === "." || file.startsWith(`${dir}/`)) {
          affected.add(pkgName);
        }
      }
    }

    return affected;
  }
}
