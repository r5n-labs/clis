import { getRemoteUrl, type Provider, parseRemoteUrl, type RemoteInfo } from "../providers";

const COMMIT_PATH: Record<Provider, string> = { bitbucket: "commits", github: "commit", gitlab: "-/commit" };
const PROVIDER_DOMAIN: Record<Provider, string> = {
  bitbucket: "bitbucket.org",
  github: "github.com",
  gitlab: "gitlab.com",
};

type RemoteInfoWithCommitUrl = RemoteInfo & { commitUrl: (hash: string) => string };

export function createCommitUrl(info: RemoteInfo): (hash: string) => string {
  const domain = PROVIDER_DOMAIN[info.provider];
  const commitPath = COMMIT_PATH[info.provider];
  const baseUrl = `https://${domain}/${info.owner}/${info.repo}`;
  return (hash: string) => `${baseUrl}/${commitPath}/${hash}`;
}

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

    this.cached = { ...info, commitUrl: createCommitUrl(info) };
    return this.cached;
  }
}
