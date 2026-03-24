import { Exit } from "@r5n/cli-core";
import { DEFAULT_BRANCH, UNKNOWN_AUTHOR } from "../constants";
import {
  type CreateLabelOptions,
  type CreatePrOptions,
  type CreateReleaseOptions,
  type FindPrOptions,
  GitProvider,
  type PullRequest,
  type RemoteInfo,
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

const DEFAULT_API_URL = "https://gitlab.com/api/v4";

export class GitLabProvider extends GitProvider {
  readonly name = "gitlab" as const;

  private authHeader: Record<string, string> = {};
  private apiUrl: string;
  private projectPath: string;

  constructor(info: RemoteInfo) {
    super(info);
    this.apiUrl = process.env.CI_API_V4_URL ?? DEFAULT_API_URL;
    this.projectPath = encodeURIComponent(`${this.owner}/${this.repo}`);
  }

  async ensureAvailable(): Promise<void> {
    this.authHeader = await this.resolveAuth();
  }

  async getDefaultBranch(): Promise<string> {
    try {
      const data = await this.api<{ default_branch: string }>(`/projects/${this.projectPath}`);
      return data.default_branch || DEFAULT_BRANCH;
    } catch {
      return DEFAULT_BRANCH;
    }
  }

  async findPr(options: FindPrOptions): Promise<PullRequest | null> {
    try {
      const params = new URLSearchParams({ per_page: "1" });
      if (options.head) params.set("source_branch", options.head);
      if (options.label) params.set("labels", options.label);

      const mrs = await this.api<GitLabMrResponse[]>(
        `/projects/${this.projectPath}/merge_requests?${params}`,
      );

      if (!mrs[0]) return null;
      return this.mapMrResponse(mrs[0]);
    } catch {
      return null;
    }
  }

  async createPr(options: CreatePrOptions): Promise<PullRequest> {
    const body: Record<string, unknown> = {
      description: options.body,
      source_branch: options.head,
      target_branch: options.base,
      title: options.title,
    };

    if (options.labels?.length) {
      body.labels = options.labels.join(",");
    }

    const data = await this.api<GitLabMrResponse>(
      `/projects/${this.projectPath}/merge_requests`,
      { body: JSON.stringify(body), method: "POST" },
    );

    return this.mapMrResponse(data);
  }

  async updatePr(number: number, options: UpdatePrOptions): Promise<void> {
    const body: Record<string, string> = {};
    if (options.title) body.title = options.title;
    if (options.body) body.description = options.body;

    await this.api(
      `/projects/${this.projectPath}/merge_requests/${number}`,
      { body: JSON.stringify(body), method: "PUT" },
    );
  }

  async getPr(number: number): Promise<PullRequest> {
    try {
      const data = await this.api<GitLabMrResponse>(
        `/projects/${this.projectPath}/merge_requests/${number}`,
      );
      return this.mapMrResponse(data);
    } catch {
      throw new Exit(`Failed to fetch MR !${number}`, "Make sure the MR exists and you have access");
    }
  }

  async getPrFromCurrentBranch(): Promise<PullRequest> {
    try {
      const result = await Bun.$`git rev-parse --abbrev-ref HEAD`.quiet();
      const branch = result.stdout.toString().trim();

      const params = new URLSearchParams({ per_page: "1", source_branch: branch, state: "opened" });
      const mrs = await this.api<GitLabMrResponse[]>(
        `/projects/${this.projectPath}/merge_requests?${params}`,
      );

      if (!mrs[0]) throw new Error("No MR found");
      return this.mapMrResponse(mrs[0]);
    } catch {
      throw new Exit("No MR found for current branch", "Make sure you have an open MR or provide a URL with --url");
    }
  }

  async getPrCommits(number: number): Promise<string[]> {
    try {
      const commits = await this.api<{ id: string }[]>(
        `/projects/${this.projectPath}/merge_requests/${number}/commits`,
      );
      return commits.map((c) => c.id);
    } catch {
      return [];
    }
  }

  async getPrFiles(number: number): Promise<string[]> {
    try {
      const data = await this.api<GitLabChangesResponse>(
        `/projects/${this.projectPath}/merge_requests/${number}/changes`,
      );
      return data.changes?.map((c) => c.new_path) ?? [];
    } catch {
      return [];
    }
  }

  async ensureLabelExists(name: string, options?: CreateLabelOptions): Promise<void> {
    try {
      const body: Record<string, string> = { name };
      if (options?.description) body.description = options.description;
      if (options?.color) body.color = `#${options.color}`;

      await this.api(`/projects/${this.projectPath}/labels`, {
        body: JSON.stringify(body),
        method: "POST",
      });
    } catch {}
  }

  async createRelease(options: CreateReleaseOptions): Promise<void> {
    await this.api(`/projects/${this.projectPath}/releases`, {
      body: JSON.stringify({
        description: options.notes,
        name: options.title,
        tag_name: options.tag,
      }),
      method: "POST",
    });
  }

  async deleteRelease(tag: string): Promise<void> {
    try {
      await this.api(`/projects/${this.projectPath}/releases/${encodeURIComponent(tag)}`, {
        method: "DELETE",
      });
    } catch {}
  }

  private async resolveAuth(): Promise<Record<string, string>> {
    const envToken = process.env.GITLAB_TOKEN ?? process.env.CI_JOB_TOKEN;
    if (envToken) return { "PRIVATE-TOKEN": envToken };

    try {
      const result = await Bun.$`glab auth status --show-token`.quiet();
      const output = result.stdout.toString() + result.stderr.toString();
      const match = output.match(/Token found:\s*(\S+)/);
      if (match?.[1]) return { Authorization: `Bearer ${match[1]}` };
    } catch {}

    throw new Exit(
      "GitLab token not found",
      "Set GITLAB_TOKEN environment variable or install glab CLI and run: glab auth login",
    );
  }

  private async api<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeader,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
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
