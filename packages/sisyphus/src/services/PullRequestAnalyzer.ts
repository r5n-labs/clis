import type { ConfigManager } from "@r5n/cli-core";
import { Exit } from "@r5n/cli-core";
import { BumpType, Commit, type CommitInfo } from "../domain";
import type { SisyphusConfig } from "../types";
import { buildPackagePathMap, findAffectedPackages } from "../utils";
import { WorkspaceScanner } from "./WorkspaceScanner";

const GITHUB_PR_URL_REGEX = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const GITLAB_MR_URL_REGEX = /gitlab\.com\//;

export type PullRequestInfo = {
  number: number;
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  labels: string[];
  author: string;
  url: string;
};

export type PrAnalysisResult = {
  pr: PullRequestInfo;
  commits: CommitInfo[];
  packages: Set<string>;
  suggestedBump: BumpType | null;
};

export class PullRequestAnalyzer {
  constructor(private config: ConfigManager<SisyphusConfig>) {}

  async analyze(url?: string): Promise<PrAnalysisResult> {
    await this.ensureGhAvailable();

    const pr = url ? await this.fetchFromUrl(url) : await this.fetchFromCurrentBranch();

    let parsedCommits = await Commit.inRange(pr.baseBranch, pr.branch);

    if (parsedCommits.length === 0 && url) {
      parsedCommits = await this.fetchCommitsFromApi(url);
    }

    const { packages } = await WorkspaceScanner.scan({ single: this.config.get("single") });
    const packagePaths = buildPackagePathMap(packages);

    const commits: CommitInfo[] = [];
    const affectedPackages = new Set<string>();

    for (const commit of parsedCommits) {
      const pkgs = findAffectedPackages(commit.files, packagePaths, false);
      if (pkgs.size === 0) continue;

      commits.push(commit.toInfo([...pkgs]));

      for (const pkg of pkgs) {
        affectedPackages.add(pkg);
      }
    }

    const suggestedBump = this.inferBumpFromLabels(pr.labels) ?? this.inferBumpFromTitle(pr.title);

    return { commits, packages: affectedPackages, pr, suggestedBump };
  }

  private async fetchCommitsFromApi(url: string): Promise<Commit[]> {
    const match = url.match(GITHUB_PR_URL_REGEX);
    if (!match) return [];

    const [, owner, repo, number] = match;

    try {
      const result = await Bun.$`gh api repos/${owner}/${repo}/pulls/${number}/commits --jq '.[].sha'`.quiet();
      const hashes = result.stdout.toString().trim().split("\n").filter(Boolean);

      const commits: Commit[] = [];
      for (const hash of hashes) {
        const commit = await Commit.fromHash(hash);
        if (commit) commits.push(commit);
      }

      return commits;
    } catch {
      return [];
    }
  }

  async fetchFromCurrentBranch(): Promise<PullRequestInfo> {
    try {
      const result = await Bun.$`gh pr view --json number,title,body,labels,author,headRefName,baseRefName,url`.quiet();
      const data = JSON.parse(result.stdout.toString());

      return {
        author: data.author?.login ?? "unknown",
        baseBranch: data.baseRefName,
        body: data.body ?? "",
        branch: data.headRefName,
        labels: data.labels?.map((l: { name: string }) => l.name) ?? [],
        number: data.number,
        title: data.title,
        url: data.url,
      };
    } catch {
      throw new Exit("No PR found for current branch", "Make sure you have an open PR or provide a URL with --url");
    }
  }

  async fetchFromUrl(url: string): Promise<PullRequestInfo> {
    if (GITLAB_MR_URL_REGEX.test(url)) {
      throw new Exit("GitLab is not supported yet", "Only GitHub PRs are currently supported");
    }

    const match = url.match(GITHUB_PR_URL_REGEX);
    if (!match) {
      throw new Exit("Invalid PR URL", "Expected a GitHub PR URL like https://github.com/owner/repo/pull/123");
    }

    const [, owner, repo, number] = match;

    try {
      const result = await Bun.$`gh api repos/${owner}/${repo}/pulls/${number}`.quiet();
      const data = JSON.parse(result.stdout.toString());

      return {
        author: data.user?.login ?? "unknown",
        baseBranch: data.base?.ref ?? "main",
        body: data.body ?? "",
        branch: data.head?.ref ?? "",
        labels: data.labels?.map((l: { name: string }) => l.name) ?? [],
        number: data.number,
        title: data.title,
        url: data.html_url,
      };
    } catch {
      throw new Exit(`Failed to fetch PR #${number}`, "Make sure the PR exists and you have access");
    }
  }

  inferBumpFromLabels(labels: string[]): BumpType | null {
    const mapping = this.config.get("pr").labelMapping;

    for (const label of labels) {
      const labelLower = label.toLowerCase();

      for (const [key, bump] of Object.entries(mapping)) {
        if (labelLower === key.toLowerCase()) {
          return bump as BumpType;
        }
      }
    }

    return null;
  }

  inferBumpFromTitle(title: string): BumpType | null {
    const titleLower = title.toLowerCase();

    if (titleLower.includes("breaking") || title.includes("!:")) {
      return BumpType.Major;
    }

    if (titleLower.includes("feat") || titleLower.includes("feature")) {
      return BumpType.Minor;
    }

    if (titleLower.includes("fix") || titleLower.includes("bug")) {
      return BumpType.Patch;
    }

    return null;
  }

  private async ensureGhAvailable(): Promise<void> {
    try {
      await Bun.$`which gh`.quiet();
    } catch {
      throw new Exit("GitHub CLI (gh) is not installed", "Install from https://cli.github.com and run: gh auth login");
    }

    try {
      await Bun.$`gh auth status`.quiet();
    } catch {
      throw new Exit("GitHub CLI (gh) is not authenticated", "Run: gh auth login");
    }
  }
}
