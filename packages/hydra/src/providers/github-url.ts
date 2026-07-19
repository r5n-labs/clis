export type GitHubTarget = { kind: "repo"; owner: string; repo: string } | { kind: "org"; org: string };

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const ORG_PATH_SEGMENTS = 1;
const REPO_PATH_SEGMENTS = 2;
const GIT_SUFFIX = /\.git$/;

export function parseGitHubUrl(url: string): GitHubTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Invalid GitHub URL (expected http(s)): ${url}`);
  }

  if (!GITHUB_HOSTS.has(parsed.hostname)) {
    throw new Error(`Invalid GitHub URL (host must be github.com): ${url}`);
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  if (segments.length === ORG_PATH_SEGMENTS) {
    const org = segments[0]?.replace(GIT_SUFFIX, "");
    if (!org) throw new Error(`Invalid GitHub URL: ${url}`);
    return { kind: "org", org };
  }

  if (segments.length === REPO_PATH_SEGMENTS) {
    const owner = segments[0];
    const repo = segments[1]?.replace(GIT_SUFFIX, "");
    if (!owner || !repo) throw new Error(`Invalid GitHub URL: ${url}`);
    return { kind: "repo", owner, repo };
  }

  throw new Error(`Invalid GitHub URL (expected github.com/<owner>/<repo> or github.com/<org>): ${url}`);
}

export function describeGitHubTarget(target: GitHubTarget): string {
  return target.kind === "repo" ? `${target.owner}/${target.repo}` : target.org;
}
