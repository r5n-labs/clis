import { getRemoteUrl, type Provider, parseRemoteUrl, type RemoteInfo } from "../providers";

const COMMIT_PATH: Record<Provider, string> = { bitbucket: "commits", github: "commit", gitlab: "-/commit" };
const PROVIDER_DOMAIN: Record<Provider, string> = {
  bitbucket: "bitbucket.org",
  github: "github.com",
  gitlab: "gitlab.com",
};

type RemoteInfoWithCommitUrl = RemoteInfo & { commitUrl: (hash: string) => string };

export class GitRemoteParser {
  private cached: RemoteInfoWithCommitUrl | null | undefined = undefined;

  async getRemoteInfo(): Promise<RemoteInfoWithCommitUrl | null> {
    if (this.cached !== undefined) return this.cached;

    const url = await getRemoteUrl();
    if (!url) {
      this.cached = null;
      return null;
    }

    const info = parseRemoteUrl(url);
    if (!info) {
      this.cached = null;
      return null;
    }

    const domain = PROVIDER_DOMAIN[info.provider];
    const commitPath = COMMIT_PATH[info.provider];
    const baseUrl = `https://${domain}/${info.owner}/${info.repo}`;

    this.cached = { ...info, commitUrl: (hash: string) => `${baseUrl}/${commitPath}/${hash}` };
    return this.cached;
  }
}
