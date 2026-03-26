import type { ConfigManager } from "@r5n/cli-core";
import { Exit } from "@r5n/cli-core";
import { OTHER_COMMIT_TYPE, SHORT_HASH_LENGTH, UNKNOWN_HASH } from "../constants";
import { BumpType, Commit, type CommitInfo } from "../domain";
import { createGitProvider, type GitProvider, type MergeMethod, type PullRequest, parsePrUrl } from "../providers";
import type { SisyphusConfig } from "../types";
import { buildPackagePathMap, findAffectedPackages } from "../utils";
import { WorkspaceScanner } from "./WorkspaceScanner";

type AnalysisContext = {
  provider: GitProvider;
  url: string | undefined;
  packagePaths: Map<string, string>;
  isSinglePackage: boolean;
};

export type PullRequestInfo = {
  number: number;
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  labels: string[];
  author: string;
  url: string;
  merged: boolean;
  mergeCommitSha: string | null;
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

    const pr = url ? await this.fetchFromUrl(provider, url) : await this.fetchFromCurrentBranch(provider);

    const isSinglePackage = this.config.get("single");
    const { packages } = await WorkspaceScanner.scan({ single: isSinglePackage });
    const packagePaths = buildPackagePathMap(packages);

    const ctx: AnalysisContext = { isSinglePackage, packagePaths, provider, url };

    const { commits, affectedPackages } = pr.merged
      ? await this.analyzeAfterMerge(pr, ctx)
      : await this.analyzeBeforeMerge(pr, ctx);

    const suggestedBump = this.inferBumpFromLabels(pr.labels) ?? this.inferBumpFromTitle(pr.title);

    return { commits, packages: affectedPackages, pr, suggestedBump };
  }

  private async analyzeBeforeMerge(
    pr: PullRequestInfo,
    ctx: AnalysisContext,
  ): Promise<{ commits: CommitInfo[]; affectedPackages: Set<string> }> {
    const parsedCommits = await Commit.inRange(pr.baseBranch, pr.branch);
    return this.processCommits(parsedCommits, ctx);
  }

  private async analyzeAfterMerge(
    pr: PullRequestInfo,
    ctx: AnalysisContext,
  ): Promise<{ commits: CommitInfo[]; affectedPackages: Set<string> }> {
    const mergeMethod = await this.detectMergeMethod(pr.mergeCommitSha);

    if (mergeMethod === "squash") {
      return this.analyzeSquashMerge(pr, ctx);
    }

    return this.analyzeMergeCommit(pr, ctx);
  }

  private async analyzeSquashMerge(
    pr: PullRequestInfo,
    ctx: AnalysisContext,
  ): Promise<{ commits: CommitInfo[]; affectedPackages: Set<string> }> {
    const files = ctx.url ? await this.fetchFilesFromApi(ctx.provider, ctx.url) : [];
    const affectedPackages = findAffectedPackages(files, ctx.packagePaths, ctx.isSinglePackage);

    const commit: CommitInfo = {
      body: pr.body || undefined,
      hash: pr.mergeCommitSha?.slice(0, SHORT_HASH_LENGTH) ?? UNKNOWN_HASH,
      message: pr.title,
      packages: [...affectedPackages],
      subject: pr.title,
      type: this.inferCommitType(pr.title),
    };

    return { affectedPackages, commits: [commit] };
  }

  private async analyzeMergeCommit(
    pr: PullRequestInfo,
    ctx: AnalysisContext,
  ): Promise<{ commits: CommitInfo[]; affectedPackages: Set<string> }> {
    if (!pr.mergeCommitSha) {
      return { affectedPackages: new Set(), commits: [] };
    }

    const parsedCommits = await Commit.fromMerge(pr.mergeCommitSha);
    return this.processCommits(parsedCommits, ctx);
  }

  private processCommits(
    parsedCommits: Commit[],
    ctx: AnalysisContext,
  ): { commits: CommitInfo[]; affectedPackages: Set<string> } {
    const commits: CommitInfo[] = [];
    const affectedPackages = new Set<string>();

    for (const commit of parsedCommits) {
      const pkgs = findAffectedPackages(commit.files, ctx.packagePaths, ctx.isSinglePackage);
      if (pkgs.size === 0) continue;

      commits.push(commit.toInfo([...pkgs]));

      for (const pkg of pkgs) {
        affectedPackages.add(pkg);
      }
    }

    return { affectedPackages, commits };
  }

  private async detectMergeMethod(mergeCommitSha: string | null): Promise<MergeMethod> {
    if (!mergeCommitSha) return "squash";

    const parentCount = await this.getCommitParentCount(mergeCommitSha);

    if (parentCount === 2) return "merge";
    return "squash";
  }

  private async getCommitParentCount(sha: string): Promise<number> {
    try {
      const result = await Bun.$`git rev-parse ${sha}^@ 2>/dev/null`.quiet();
      const parents = result.stdout.toString().trim().split("\n").filter(Boolean);
      return parents.length;
    } catch {
      return 1;
    }
  }

  private inferCommitType(title: string): string {
    const match = title.match(/^(\w+)(?:\(.*?\))?!?:/);
    return match?.[1] ?? OTHER_COMMIT_TYPE;
  }

  private async getProvider(): Promise<GitProvider> {
    if (!this.provider) {
      this.provider = await createGitProvider();
    }
    return this.provider;
  }

  private async fetchFilesFromApi(provider: GitProvider, url: string): Promise<string[]> {
    const urlInfo = parsePrUrl(url);
    if (!urlInfo) return [];

    return provider.getPrFiles(urlInfo.number);
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

  private mapPullRequest({ headBranch, ...pr }: PullRequest): PullRequestInfo {
    return { ...pr, branch: headBranch };
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
