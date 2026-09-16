import { Exit } from "@r5n/cli-core";
import { DEFAULT_BRANCH, UNKNOWN_AUTHOR } from "../constants";
import {
  type CreateLabelOptions,
  type CreatePrOptions,
  type CreateReleaseOptions,
  type FindPrOptions,
  GitProvider,
  type GitRelease,
  type PullRequest,
  type UpdatePrOptions,
} from "./GitProvider";

type GitHubReleaseResponse = { tag_name: string; name: string | null; body: string | null; draft: boolean };

type GitHubRestPrResponse = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  merged: boolean;
  merge_commit_sha: string | null;
  user: { login: string } | null;
  base: { ref: string } | null;
  head: { ref: string } | null;
  labels: { name: string }[] | null;
};

type GitHubCliPrResponse = {
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: string;
  baseRefName: string;
  headRefName: string;
  author: { login: string } | null;
  labels: { name: string }[] | null;
  mergeCommit: { oid: string } | null;
};

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const DECIMAL_RADIX = 10;

function isGitHubReleaseResponse(value: unknown): value is GitHubReleaseResponse {
  if (typeof value !== "object" || value === null) return false;

  const release = value as Record<string, unknown>;
  return (
    typeof release.tag_name === "string" &&
    typeof release.draft === "boolean" &&
    (typeof release.name === "string" || release.name === null) &&
    (typeof release.body === "string" || release.body === null)
  );
}

export class GitHubProvider extends GitProvider {
  readonly name = "github" as const;

  private get apiPath(): string {
    return `repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  async ensureAvailable(): Promise<void> {
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

  async getDefaultBranch(): Promise<string> {
    try {
      const result = await Bun.$`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`.quiet();
      return result.stdout.toString().trim() || DEFAULT_BRANCH;
    } catch {
      return DEFAULT_BRANCH;
    }
  }

  async findPr(options: FindPrOptions): Promise<PullRequest | null> {
    try {
      const optionalArgs: string[] = [];
      if (options.head) optionalArgs.push("--head", options.head);
      if (options.label) optionalArgs.push("--label", options.label);

      const result =
        await Bun.$`gh pr list --json number,url,title,body,labels,author,headRefName,baseRefName,mergeCommit,state --limit 1 ${optionalArgs}`.quiet();
      const prs = JSON.parse(result.stdout.toString());

      if (!prs[0]) return null;

      return this.mapPrResponse(prs[0]);
    } catch {
      return null;
    }
  }

  async createPr(options: CreatePrOptions): Promise<PullRequest> {
    const result =
      await Bun.$`gh api ${this.apiPath}/pulls --method POST -f head=${options.head} -f base=${options.base} -f title=${options.title} -f body=${options.body}`;

    const data = JSON.parse(result.stdout.toString());
    const prNumber = data.number as number;

    if (options.labels && options.labels.length > 0) {
      const labelArgs = options.labels.flatMap((l) => ["-f", `labels[]=${l}`]);
      await Bun.$`gh api ${this.apiPath}/issues/${prNumber}/labels --method POST ${labelArgs}`;
    }

    return this.getPr(prNumber);
  }

  async updatePr(number: number, options: UpdatePrOptions): Promise<void> {
    const optionalArgs: string[] = [];
    if (options.title) optionalArgs.push("--title", options.title);
    if (options.body) optionalArgs.push("--body", options.body);

    await Bun.$`gh pr edit ${number} ${optionalArgs}`;
  }

  async getPr(number: number): Promise<PullRequest> {
    try {
      const result = await Bun.$`gh api ${this.apiPath}/pulls/${number}`.quiet();
      const data = JSON.parse(result.stdout.toString());

      return this.mapRestApiResponse(data);
    } catch {
      throw new Exit(`Failed to fetch PR #${number}`, "Make sure the PR exists and you have access");
    }
  }

  async getPrFromCurrentBranch(): Promise<PullRequest> {
    try {
      const result =
        await Bun.$`gh pr view --json number,title,body,labels,author,headRefName,baseRefName,url,mergeCommit,state`.quiet();
      const data = JSON.parse(result.stdout.toString());

      return this.mapPrResponse(data);
    } catch {
      throw new Exit("No PR found for current branch", "Make sure you have an open PR or provide a URL with --url");
    }
  }

  async getPrCommits(number: number): Promise<string[]> {
    try {
      const result = await Bun.$`gh api ${this.apiPath}/pulls/${number}/commits --jq '.[].sha'`.quiet();
      return result.stdout.toString().trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  async getPrFiles(number: number): Promise<string[]> {
    try {
      const result = await Bun.$`gh api ${this.apiPath}/pulls/${number}/files --jq '.[].filename'`.quiet();
      return result.stdout.toString().trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  async ensureLabelExists(name: string, options?: CreateLabelOptions): Promise<void> {
    try {
      const description = options?.description ?? "";
      const colorArgs = options?.color ? ["--color", options.color] : [];
      await Bun.$`gh label create ${name} --description ${description} ${colorArgs} --force`.quiet();
    } catch {}
  }

  async getRelease(tag: string): Promise<GitRelease | null> {
    const endpoint = `${this.apiPath}/releases/tags/${encodeURIComponent(tag)}`;
    const result = await Bun.$`gh api ${endpoint} --include`.quiet().nothrow();
    const output = result.stdout.toString().replaceAll("\r\n", "\n");
    const [headers = "", ...bodyParts] = output.split("\n\n");
    const statusText = headers.match(/^HTTP\/\S+\s+(\d{3})\b/m)?.[1];
    const status = statusText ? Number.parseInt(statusText, DECIMAL_RADIX) : null;

    if (result.exitCode !== 0) {
      if (status === HTTP_NOT_FOUND) return null;

      const reason = status
        ? `GitHub API returned HTTP ${status}`
        : `gh api failed with exit code ${result.exitCode}; check authentication and network connectivity`;
      throw this.releaseReadError(tag, reason);
    }

    if (status !== HTTP_OK) {
      throw this.releaseReadError(tag, status ? `GitHub API returned HTTP ${status}` : "missing HTTP status");
    }

    let data: unknown;
    try {
      data = JSON.parse(bodyParts.join("\n\n"));
    } catch {
      throw this.releaseReadError(tag, "response was not valid JSON");
    }

    if (!isGitHubReleaseResponse(data)) {
      throw this.releaseReadError(tag, "response did not contain tag_name, name, and body");
    }

    return { draft: data.draft, notes: data.body ?? "", tag: data.tag_name, title: data.name ?? "" };
  }

  async createRelease(options: CreateReleaseOptions): Promise<void> {
    await Bun.$`gh release create ${options.tag} --repo ${`${this.owner}/${this.repo}`} --title ${options.title} --notes ${options.notes} --verify-tag`.quiet();
  }

  async deleteRelease(tag: string): Promise<void> {
    try {
      await Bun.$`gh release delete ${tag} --yes`.quiet();
    } catch {}
  }

  private mapRestApiResponse(data: GitHubRestPrResponse): PullRequest {
    return {
      author: data.user?.login ?? UNKNOWN_AUTHOR,
      baseBranch: data.base?.ref ?? DEFAULT_BRANCH,
      body: data.body ?? "",
      headBranch: data.head?.ref ?? "",
      labels: data.labels?.map((l) => l.name) ?? [],
      mergeCommitSha: data.merge_commit_sha,
      merged: data.merged,
      number: data.number,
      title: data.title,
      url: data.html_url,
    };
  }

  private mapPrResponse(data: GitHubCliPrResponse): PullRequest {
    return {
      author: data.author?.login ?? UNKNOWN_AUTHOR,
      baseBranch: data.baseRefName ?? DEFAULT_BRANCH,
      body: data.body ?? "",
      headBranch: data.headRefName ?? "",
      labels: data.labels?.map((l) => l.name) ?? [],
      mergeCommitSha: data.mergeCommit?.oid ?? null,
      merged: data.state === "MERGED",
      number: data.number,
      title: data.title,
      url: data.url,
    };
  }

  private releaseReadError(tag: string, reason: string): Error {
    return new Error(`Failed to fetch GitHub release "${tag}" from ${this.owner}/${this.repo}: ${reason}`);
  }
}
