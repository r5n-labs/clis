import { Exit } from "@r5n/cli-core";
import { DEFAULT_BRANCH, UNKNOWN_AUTHOR } from "../constants";
import {
  type CreateLabelOptions,
  type CreatePrOptions,
  type CreateReleaseOptions,
  type FindPrOptions,
  GitProvider,
  type PullRequest,
  type UpdatePrOptions,
} from "./GitProvider";

type GitLabMrResponse = {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: string;
  target_branch: string;
  source_branch: string;
  merge_commit_sha: string | null;
  author: { username: string } | null;
  labels: string[];
};

type GitLabChangesResponse = { changes: { new_path: string }[] };

export class GitLabProvider extends GitProvider {
  readonly name = "gitlab" as const;

  private get projectPath(): string {
    return `${encodeURIComponent(this.owner)}%2F${encodeURIComponent(this.repo)}`;
  }

  async ensureAvailable(): Promise<void> {
    try {
      await Bun.$`which glab`.quiet();
    } catch {
      throw new Exit(
        "GitLab CLI (glab) is not installed",
        "Install from https://gitlab.com/gitlab-org/cli and run: glab auth login",
      );
    }

    try {
      await Bun.$`glab auth status`.quiet();
    } catch {
      throw new Exit("GitLab CLI (glab) is not authenticated", "Run: glab auth login");
    }
  }

  async getDefaultBranch(): Promise<string> {
    try {
      const result = await Bun.$`glab repo view --output json`.quiet();
      const data = JSON.parse(result.stdout.toString());
      return data.default_branch || DEFAULT_BRANCH;
    } catch {
      return DEFAULT_BRANCH;
    }
  }

  async findPr(options: FindPrOptions): Promise<PullRequest | null> {
    try {
      const optionalArgs: string[] = [];
      if (options.head) optionalArgs.push("--source-branch", options.head);
      if (options.label) optionalArgs.push("--label", options.label);

      const result = await Bun.$`glab mr list --output json --per-page 1 ${optionalArgs}`.quiet();
      const mrs = JSON.parse(result.stdout.toString());

      if (!mrs[0]) return null;

      return this.mapMrResponse(mrs[0]);
    } catch {
      return null;
    }
  }

  async createPr(options: CreatePrOptions): Promise<PullRequest> {
    const labelArgs = options.labels?.flatMap((l) => ["--label", l]) ?? [];

    const result =
      await Bun.$`glab mr create --source-branch ${options.head} --target-branch ${options.base} --title ${options.title} --description ${options.body} ${labelArgs} --yes`;

    const iid = this.extractMrNumber(result.stdout.toString());
    return this.getPr(iid);
  }

  async updatePr(number: number, options: UpdatePrOptions): Promise<void> {
    const optionalArgs: string[] = [];
    if (options.title) optionalArgs.push("--title", options.title);
    if (options.body) optionalArgs.push("--description", options.body);

    await Bun.$`glab mr update ${number} ${optionalArgs}`;
  }

  async getPr(number: number): Promise<PullRequest> {
    try {
      const result = await Bun.$`glab mr view ${number} --output json`.quiet();
      return this.mapMrResponse(JSON.parse(result.stdout.toString()));
    } catch {
      throw new Exit(`Failed to fetch MR !${number}`, "Make sure the MR exists and you have access");
    }
  }

  async getPrFromCurrentBranch(): Promise<PullRequest> {
    try {
      const result = await Bun.$`glab mr view --output json`.quiet();
      return this.mapMrResponse(JSON.parse(result.stdout.toString()));
    } catch {
      throw new Exit("No MR found for current branch", "Make sure you have an open MR or provide a URL with --url");
    }
  }

  async getPrCommits(number: number): Promise<string[]> {
    try {
      const result =
        await Bun.$`glab api projects/${this.projectPath}/merge_requests/${number}/commits`.quiet();
      const commits = JSON.parse(result.stdout.toString());
      return commits.map((c: { id: string }) => c.id);
    } catch {
      return [];
    }
  }

  async getPrFiles(number: number): Promise<string[]> {
    try {
      const result =
        await Bun.$`glab api projects/${this.projectPath}/merge_requests/${number}/changes`.quiet();
      const data: GitLabChangesResponse = JSON.parse(result.stdout.toString());
      return data.changes?.map((c) => c.new_path) ?? [];
    } catch {
      return [];
    }
  }

  async ensureLabelExists(name: string, options?: CreateLabelOptions): Promise<void> {
    try {
      const description = options?.description ?? "";
      const colorArgs = options?.color ? ["--color", `#${options.color}`] : [];
      await Bun.$`glab label create --name ${name} --description ${description} ${colorArgs}`.quiet();
    } catch {}
  }

  async createRelease(options: CreateReleaseOptions): Promise<void> {
    await Bun.$`glab release create ${options.tag} --name ${options.title} --notes ${options.notes}`;
  }

  async deleteRelease(tag: string): Promise<void> {
    try {
      await Bun.$`glab release delete ${tag} --yes`.quiet();
    } catch {}
  }

  private extractMrNumber(output: string): number {
    const bangMatch = output.match(/!(\d+)/);
    if (bangMatch?.[1]) return Number.parseInt(bangMatch[1], 10);

    const urlMatch = output.match(/merge_requests\/(\d+)/);
    if (urlMatch?.[1]) return Number.parseInt(urlMatch[1], 10);

    throw new Exit("Failed to parse MR number from output", output);
  }

  private mapMrResponse(data: GitLabMrResponse): PullRequest {
    return {
      author: data.author?.username ?? UNKNOWN_AUTHOR,
      baseBranch: data.target_branch ?? DEFAULT_BRANCH,
      body: data.description ?? "",
      headBranch: data.source_branch ?? "",
      labels: data.labels ?? [],
      mergeCommitSha: data.merge_commit_sha,
      merged: data.state === "merged",
      number: data.iid,
      title: data.title,
      url: data.web_url,
    };
  }
}
