const GITHUB_PATTERN = /github\.com[:/]([^/]+)\/([^/.]+)/;
const GITLAB_PATTERN = /gitlab\.com[:/]([^/]+)\/([^/.]+)/;
const BITBUCKET_PATTERN = /bitbucket\.org[:/]([^/]+)\/([^/.]+)/;

type Provider = "github" | "gitlab" | "bitbucket";

type RemoteInfo = { provider: Provider; owner: string; repo: string; commitUrl: (hash: string) => string };

const COMMIT_PATH: Record<Provider, string> = { bitbucket: "commits", github: "commit", gitlab: "-/commit" };
const PROVIDER_DOMAIN: Record<Provider, string> = {
  bitbucket: "bitbucket.org",
  github: "github.com",
  gitlab: "gitlab.com",
};

export class GitRemoteParser {
  private cached: RemoteInfo | null | undefined = undefined;

  async getRemoteInfo(): Promise<RemoteInfo | null> {
    if (this.cached !== undefined) return this.cached;

    const url = await this.getRemoteUrl();
    if (!url) {
      this.cached = null;
      return null;
    }

    this.cached = this.parseUrl(url);
    return this.cached;
  }

  private async getRemoteUrl(): Promise<string | null> {
    try {
      const result = await Bun.$`git remote get-url origin`.quiet();
      return result.stdout.toString().trim() || null;
    } catch {
      return null;
    }
  }

  private parseUrl(url: string): RemoteInfo | null {
    const patterns: [RegExp, Provider][] = [
      [GITHUB_PATTERN, "github"],
      [GITLAB_PATTERN, "gitlab"],
      [BITBUCKET_PATTERN, "bitbucket"],
    ];

    for (const [pattern, provider] of patterns) {
      const match = url.match(pattern);
      if (match) {
        const [, owner, repo] = match;
        if (owner && repo) {
          return this.createRemoteInfo(provider, owner, repo);
        }
      }
    }

    return null;
  }

  private createRemoteInfo(provider: Provider, owner: string, repo: string): RemoteInfo {
    const domain = PROVIDER_DOMAIN[provider];
    const commitPath = COMMIT_PATH[provider];
    const baseUrl = `https://${domain}/${owner}/${repo}`;

    return { commitUrl: (hash: string) => `${baseUrl}/${commitPath}/${hash}`, owner, provider, repo };
  }
}
