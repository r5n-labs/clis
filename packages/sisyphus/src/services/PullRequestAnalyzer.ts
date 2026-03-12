import type { ConfigManager } from "@r5n/cli-core";
import { Exit } from "@r5n/cli-core";
import { BumpType, Commit, type CommitInfo } from "../domain";
import { createGitProvider, type GitProvider, type PullRequest, parsePrUrl } from "../providers";
import type { SisyphusConfig } from "../types";
import { buildPackagePathMap, findAffectedPackages } from "../utils";
import { WorkspaceScanner } from "./WorkspaceScanner";

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
  private provider: GitProvider | null = null;

  constructor(private config: ConfigManager<SisyphusConfig>) {}

  async analyze(url?: string): Promise<PrAnalysisResult> {
    const provider = await this.getProvider();
    await provider.ensureAvailable();

    const pr = url ? await this.fetchFromUrl(provider, url) : await this.fetchFromCurrentBranch(provider);

    let parsedCommits = await Commit.inRange(pr.baseBranch, pr.branch);

    if (parsedCommits.length === 0 && url) {
      parsedCommits = await this.fetchCommitsFromApi(provider, url);
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

  private async getProvider(): Promise<GitProvider> {
    if (!this.provider) {
      this.provider = await createGitProvider();
    }
    return this.provider;
  }

  private async fetchCommitsFromApi(provider: GitProvider, url: string): Promise<Commit[]> {
    const urlInfo = parsePrUrl(url);
    if (!urlInfo) return [];

    try {
      const hashes = await provider.getPrCommits(urlInfo.number);

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

  private async fetchFromCurrentBranch(provider: GitProvider): Promise<PullRequestInfo> {
    const pr = await provider.getPrFromCurrentBranch();
    return this.mapPullRequest(pr);
  }

  private async fetchFromUrl(provider: GitProvider, url: string): Promise<PullRequestInfo> {
    const urlInfo = parsePrUrl(url);

    if (!urlInfo) {
      throw new Exit("Invalid PR URL", "Expected a PR/MR URL from GitHub, GitLab, or Bitbucket");
    }

    if (urlInfo.provider !== provider.name) {
      throw new Exit(
        `PR URL is from ${urlInfo.provider}, but repository is on ${provider.name}`,
        "Make sure the PR URL matches the repository provider",
      );
    }

    const pr = await provider.getPr(urlInfo.number);
    return this.mapPullRequest(pr);
  }

  private mapPullRequest(pr: PullRequest): PullRequestInfo {
    return {
      author: pr.author,
      baseBranch: pr.baseBranch,
      body: pr.body,
      branch: pr.headBranch,
      labels: pr.labels,
      number: pr.number,
      title: pr.title,
      url: pr.url,
    };
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
}
