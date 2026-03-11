import { Exit } from "@r5n/cli-core";
import {
  type CreateLabelOptions,
  type CreatePrOptions,
  type CreateReleaseOptions,
  type FindPrOptions,
  GitProvider,
  type PullRequest,
  type UpdatePrOptions,
} from "./GitProvider";

const DEFAULT_BRANCH = "main";

export class GitLabProvider extends GitProvider {
  readonly name = "gitlab" as const;

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
      await Bun.$`glab mr create --source-branch ${options.head} --target-branch ${options.base} --title ${options.title} --description ${options.body} ${labelArgs} --yes`.quiet();

    const iid = this.extractMrNumber(result.stdout.toString());
    return this.getPr(iid);
  }

  async updatePr(number: number, options: UpdatePrOptions): Promise<void> {
    const optionalArgs: string[] = [];
    if (options.title) optionalArgs.push("--title", options.title);
    if (options.body) optionalArgs.push("--description", options.body);

    await Bun.$`glab mr update ${number} ${optionalArgs}`.quiet();
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
        await Bun.$`glab api projects/${this.owner}%2F${this.repo}/merge_requests/${number}/commits`.quiet();
      const commits = JSON.parse(result.stdout.toString());
      return commits.map((c: { id: string }) => c.id);
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
    await Bun.$`glab release create ${options.tag} --name ${options.title} --notes ${options.notes}`.quiet();
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

  private mapMrResponse(data: Record<string, unknown>): PullRequest {
    return {
      author: (data.author as { username?: string })?.username ?? "unknown",
      baseBranch: (data.target_branch as string) ?? DEFAULT_BRANCH,
      body: (data.description as string) ?? "",
      headBranch: (data.source_branch as string) ?? "",
      labels: (data.labels as string[]) ?? [],
      number: data.iid as number,
      title: data.title as string,
      url: data.web_url as string,
    };
  }
}
