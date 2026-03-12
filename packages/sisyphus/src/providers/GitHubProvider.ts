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

export class GitHubProvider extends GitProvider {
  readonly name = "github" as const;

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
        await Bun.$`gh pr list --json number,url,title,body,labels,author,headRefName,baseRefName --limit 1 ${optionalArgs}`.quiet();
      const prs = JSON.parse(result.stdout.toString());

      if (!prs[0]) return null;

      return this.mapPrResponse(prs[0]);
    } catch {
      return null;
    }
  }

  async createPr(options: CreatePrOptions): Promise<PullRequest> {
    const labelArgs = options.labels?.flatMap((l) => ["--label", l]) ?? [];

    const result =
      await Bun.$`gh pr create --head ${options.head} --base ${options.base} --title ${options.title} --body ${options.body} ${labelArgs}`.quiet();

    const url = result.stdout.toString().trim();
    const number = this.extractPrNumber(url);

    return this.getPr(number);
  }

  async updatePr(number: number, options: UpdatePrOptions): Promise<void> {
    const optionalArgs: string[] = [];
    if (options.title) optionalArgs.push("--title", options.title);
    if (options.body) optionalArgs.push("--body", options.body);

    await Bun.$`gh pr edit ${number} ${optionalArgs}`.quiet();
  }

  async getPr(number: number): Promise<PullRequest> {
    try {
      const result = await Bun.$`gh api repos/${this.owner}/${this.repo}/pulls/${number}`.quiet();
      const data = JSON.parse(result.stdout.toString());

      return {
        author: data.user?.login ?? "unknown",
        baseBranch: data.base?.ref ?? DEFAULT_BRANCH,
        body: data.body ?? "",
        headBranch: data.head?.ref ?? "",
        labels: data.labels?.map((l: { name: string }) => l.name) ?? [],
        number: data.number,
        title: data.title,
        url: data.html_url,
      };
    } catch {
      throw new Exit(`Failed to fetch PR #${number}`, "Make sure the PR exists and you have access");
    }
  }

  async getPrFromCurrentBranch(): Promise<PullRequest> {
    try {
      const result = await Bun.$`gh pr view --json number,title,body,labels,author,headRefName,baseRefName,url`.quiet();
      const data = JSON.parse(result.stdout.toString());

      return {
        author: data.author?.login ?? "unknown",
        baseBranch: data.baseRefName,
        body: data.body ?? "",
        headBranch: data.headRefName,
        labels: data.labels?.map((l: { name: string }) => l.name) ?? [],
        number: data.number,
        title: data.title,
        url: data.url,
      };
    } catch {
      throw new Exit("No PR found for current branch", "Make sure you have an open PR or provide a URL with --url");
    }
  }

  async getPrCommits(number: number): Promise<string[]> {
    try {
      const result =
        await Bun.$`gh api repos/${this.owner}/${this.repo}/pulls/${number}/commits --jq '.[].sha'`.quiet();
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

  async createRelease(options: CreateReleaseOptions): Promise<void> {
    await Bun.$`gh release create ${options.tag} --title ${options.title} --notes ${options.notes}`.quiet();
  }

  async deleteRelease(tag: string): Promise<void> {
    try {
      await Bun.$`gh release delete ${tag} --yes`.quiet();
    } catch {}
  }

  private extractPrNumber(url: string): number {
    const match = url.match(/\/pull\/(\d+)$/);
    if (!match?.[1]) throw new Exit("Failed to parse PR number from URL", url);
    return Number.parseInt(match[1], 10);
  }

  private mapPrResponse(data: Record<string, unknown>): PullRequest {
    return {
      author: (data.author as { login?: string })?.login ?? "unknown",
      baseBranch: data.baseRefName as string,
      body: (data.body as string) ?? "",
      headBranch: data.headRefName as string,
      labels: ((data.labels as { name: string }[]) ?? []).map((l) => l.name),
      number: data.number as number,
      title: data.title as string,
      url: data.url as string,
    };
  }
}
