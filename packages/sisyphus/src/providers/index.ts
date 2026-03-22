import { Exit } from "@r5n/cli-core";
import { BitbucketProvider } from "./BitbucketProvider";
import { GitHubProvider } from "./GitHubProvider";
import { GitLabProvider } from "./GitLabProvider";
import type { Provider, PrUrlInfo, RemoteInfo } from "./GitProvider";

export { BitbucketProvider } from "./BitbucketProvider";
export { GitHubProvider } from "./GitHubProvider";
export { GitLabProvider } from "./GitLabProvider";
export {
  GitProvider,
  type MergeMethod,
  type Provider,
  type PrUrlInfo,
  type PullRequest,
  type RemoteInfo,
} from "./GitProvider";

const GITHUB_PATTERN = /github\.com[:/]([^/]+)\/([^/.]+)/;
const GITLAB_PATTERN = /gitlab\.com[:/]([^/]+)\/([^/.]+)/;
const BITBUCKET_PATTERN = /bitbucket\.org[:/]([^/]+)\/([^/.]+)/;

const GITHUB_PR_URL_PATTERN = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const GITLAB_MR_URL_PATTERN = /gitlab\.com\/([^/]+)\/([^/]+)\/-\/merge_requests\/(\d+)/;
const BITBUCKET_PR_URL_PATTERN = /bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/;

export async function createGitProvider() {
  const info = await detectRemoteInfo();

  if (!info) {
    throw new Exit("Could not detect git provider", "Make sure you have a git remote configured (origin)");
  }

  switch (info.provider) {
    case "github":
      return new GitHubProvider(info);
    case "gitlab":
      return new GitLabProvider(info);
    case "bitbucket":
      return new BitbucketProvider(info);
    default:
      throw new Exit(`Unsupported provider: ${info.provider}`);
  }
}

async function detectRemoteInfo(): Promise<RemoteInfo | null> {
  const url = await getRemoteUrl();
  if (!url) return null;
  return parseRemoteUrl(url);
}

export async function detectProvider(): Promise<Provider> {
  const info = await detectRemoteInfo();
  if (!info) {
    throw new Exit("Could not detect git provider", "Make sure you have a git remote configured (origin)");
  }
  return info.provider;
}

export async function getRemoteUrl(): Promise<string | null> {
  try {
    const result = await Bun.$`git remote get-url origin`.quiet();
    return result.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

export function parseRemoteUrl(url: string): RemoteInfo | null {
  const patterns: [RegExp, Provider][] = [
    [GITHUB_PATTERN, "github"],
    [GITLAB_PATTERN, "gitlab"],
    [BITBUCKET_PATTERN, "bitbucket"],
  ];

  for (const [pattern, provider] of patterns) {
    const match = url.match(pattern);
    if (!match) continue;

    const [, owner, repo] = match;
    if (owner && repo) {
      return { owner, provider, repo };
    }
  }

  return null;
}

export function parsePrUrl(url: string): PrUrlInfo | null {
  const patterns: [RegExp, Provider][] = [
    [GITHUB_PR_URL_PATTERN, "github"],
    [GITLAB_MR_URL_PATTERN, "gitlab"],
    [BITBUCKET_PR_URL_PATTERN, "bitbucket"],
  ];

  for (const [pattern, provider] of patterns) {
    const match = url.match(pattern);
    if (!match) continue;

    const [, owner, repo, number] = match;
    if (owner && repo && number) {
      return { number: Number.parseInt(number, 10), owner, provider, repo };
    }
  }

  return null;
}
