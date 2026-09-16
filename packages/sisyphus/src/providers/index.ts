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
  type GitRelease,
  type MergeMethod,
  type Provider,
  type PrUrlInfo,
  type PullRequest,
  type RemoteInfo,
} from "./GitProvider";

const PR_PATH_PATTERNS: Record<Provider, RegExp> = {
  github: /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/|$)/,
  gitlab: /^\/(.+)\/([^/]+)\/-\/merge_requests\/([1-9]\d*)(?:\/|$)/,
  bitbucket: /^\/([^/]+)\/([^/]+)\/pull-requests\/([1-9]\d*)(?:\/|$)/,
};

export async function createGitProvider(remoteInfo?: RemoteInfo) {
  const info = remoteInfo ?? (await detectRemoteInfo());

  if (!info) {
    throw new Exit("Could not detect git provider", "Make sure you have a git remote configured (origin)");
  }

  const provider = createProvider(info);
  await provider.ensureAvailable();
  return provider;
}

function createProvider(info: RemoteInfo) {
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
  const parsed = parseRemoteLocation(url);
  if (!parsed) return null;
  const provider = providerFromHostname(parsed.hostname);
  if (!provider) return null;

  const segments = parsed.path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  const repo = segments.pop();
  if (!repo || segments.length === 0) return null;
  if (provider !== "gitlab" && segments.length !== 1) return null;

  return { owner: segments.join("/"), provider, repo };
}

function parseRemoteLocation(url: string): { hostname: string; path: string } | null {
  try {
    const parsed = new URL(url);
    return { hostname: parsed.hostname.toLowerCase(), path: parsed.pathname };
  } catch {
    const match = url.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
    const hostname = match?.[1];
    const path = match?.[2];
    return hostname && path ? { hostname: hostname.toLowerCase(), path } : null;
  }
}

function providerFromHostname(hostname: string): Provider | null {
  if (hostname === "github.com") return "github";
  if (hostname === "gitlab.com") return "gitlab";
  if (hostname === "bitbucket.org") return "bitbucket";
  return null;
}

export function parsePrUrl(url: string): PrUrlInfo | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const provider = providerFromHostname(parsed.hostname.toLowerCase());
    if (!provider) return null;
    const match = parsed.pathname.match(PR_PATH_PATTERNS[provider]);
    const [, owner, repo, id] = match ?? [];
    const number = Number(id);
    if (!owner || !repo || !Number.isSafeInteger(number)) return null;
    return { number, owner, provider, repo };
  } catch {
    return null;
  }
}
