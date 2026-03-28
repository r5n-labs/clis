import { describe, expect, test } from "bun:test";

const GITHUB_PATTERN = /github\.com[:/]([^/]+)\/([^/.]+)/;
const GITLAB_PATTERN = /gitlab\.com[:/]([^/]+)\/([^/.]+)/;
const BITBUCKET_PATTERN = /bitbucket\.org[:/]([^/]+)\/([^/.]+)/;

type Provider = "github" | "gitlab" | "bitbucket";

const PROVIDER_DOMAIN: Record<Provider, string> = {
  bitbucket: "bitbucket.org",
  github: "github.com",
  gitlab: "gitlab.com",
};

const COMMIT_PATH: Record<Provider, string> = { bitbucket: "commits", github: "commit", gitlab: "-/commit" };

function parseUrl(
  url: string,
): { provider: Provider; owner: string; repo: string; commitUrl: (hash: string) => string } | null {
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
        const domain = PROVIDER_DOMAIN[provider];
        const commitPath = COMMIT_PATH[provider];
        const baseUrl = `https://${domain}/${owner}/${repo}`;
        return { commitUrl: (hash: string) => `${baseUrl}/${commitPath}/${hash}`, owner, provider, repo };
      }
    }
  }

  return null;
}

describe("GitRemoteParser URL parsing", () => {
  describe("GitHub", () => {
    test("parses HTTPS URL with .git suffix", () => {
      expect(parseUrl("https://github.com/owner/repo.git")).toMatchObject({
        owner: "owner",
        provider: "github",
        repo: "repo",
      });
    });

    test("parses SSH URL", () => {
      expect(parseUrl("git@github.com:owner/repo.git")).toMatchObject({
        owner: "owner",
        provider: "github",
        repo: "repo",
      });
    });

    test("parses HTTPS URL without .git suffix", () => {
      expect(parseUrl("https://github.com/owner/repo")).toMatchObject({
        owner: "owner",
        provider: "github",
        repo: "repo",
      });
    });

    test("generates correct commit URL", () => {
      expect(parseUrl("https://github.com/owner/repo.git")?.commitUrl("abc123")).toBe(
        "https://github.com/owner/repo/commit/abc123",
      );
    });
  });

  describe("GitLab", () => {
    test("parses HTTPS URL with .git suffix", () => {
      expect(parseUrl("https://gitlab.com/owner/repo.git")).toMatchObject({
        owner: "owner",
        provider: "gitlab",
        repo: "repo",
      });
    });

    test("parses SSH URL", () => {
      expect(parseUrl("git@gitlab.com:owner/repo.git")).toMatchObject({
        owner: "owner",
        provider: "gitlab",
        repo: "repo",
      });
    });

    test("generates correct commit URL with -/commit path", () => {
      expect(parseUrl("https://gitlab.com/owner/repo.git")?.commitUrl("def456")).toBe(
        "https://gitlab.com/owner/repo/-/commit/def456",
      );
    });
  });

  describe("Bitbucket", () => {
    test("parses HTTPS URL with .git suffix", () => {
      expect(parseUrl("https://bitbucket.org/owner/repo.git")).toMatchObject({
        owner: "owner",
        provider: "bitbucket",
        repo: "repo",
      });
    });

    test("parses SSH URL", () => {
      expect(parseUrl("git@bitbucket.org:owner/repo.git")).toMatchObject({
        owner: "owner",
        provider: "bitbucket",
        repo: "repo",
      });
    });

    test("generates correct commit URL with commits path", () => {
      expect(parseUrl("https://bitbucket.org/owner/repo.git")?.commitUrl("789abc")).toBe(
        "https://bitbucket.org/owner/repo/commits/789abc",
      );
    });
  });

  describe("URL with credentials", () => {
    test("parses HTTPS URL containing user:token credentials", () => {
      expect(parseUrl("https://user:token@github.com/owner/repo.git")).toMatchObject({
        owner: "owner",
        provider: "github",
        repo: "repo",
      });
    });
  });

  describe("no match cases", () => {
    test.each(["https://sourcehut.org/owner/repo.git", "not-a-url", ""])("returns null for %j", (url) => {
      expect(parseUrl(url)).toBeNull();
    });
  });

  describe("known bugs", () => {
    test("BUG: dots in repo names - captures only text before first dot", () => {
      expect(parseUrl("https://github.com/owner/my.project.git")).toMatchObject({ owner: "owner", repo: "my" });
    });

    test("BUG: GitLab nested subgroups - captures group as owner, subgroup as repo", () => {
      expect(parseUrl("https://gitlab.com/group/subgroup/repo.git")).toMatchObject({
        owner: "group",
        repo: "subgroup",
      });
    });
  });
});
