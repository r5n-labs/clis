import { describe, expect, test } from "bun:test";
import { parsePrUrl, parseRemoteUrl } from "../../src/providers";
import { createCommitUrl } from "../../src/services/GitRemoteParser";

describe("production git remote parsing", () => {
  test.each([
    ["https://github.com/owner/my.project.git", "github", "owner", "my.project"],
    ["git@github.com:owner/repo.git", "github", "owner", "repo"],
    ["ssh://git@github.com/owner/repo.git", "github", "owner", "repo"],
    ["https://user:token@github.com/owner/repo.git", "github", "owner", "repo"],
    ["https://gitlab.com/group/subgroup/repo.git", "gitlab", "group/subgroup", "repo"],
    ["git@gitlab.com:group/subgroup/nested/repo.git", "gitlab", "group/subgroup/nested", "repo"],
    ["https://bitbucket.org/owner/repo.git", "bitbucket", "owner", "repo"],
    ["git@bitbucket.org:owner/repo.git", "bitbucket", "owner", "repo"],
  ] as const)("parses %s", (url, provider, owner, repo) => {
    expect(parseRemoteUrl(url ?? "")).toEqual({ owner, provider, repo });
  });

  test.each([
    ["https://github.com/owner/repo.git", "https://github.com/owner/repo/commit/abc123"],
    ["https://gitlab.com/group/subgroup/repo.git", "https://gitlab.com/group/subgroup/repo/-/commit/abc123"],
    ["https://bitbucket.org/owner/repo.git", "https://bitbucket.org/owner/repo/commits/abc123"],
  ])("generates a commit URL from %s", (url, expected) => {
    const remote = parseRemoteUrl(url ?? "");
    if (!remote) throw new Error("Expected a parsed remote");
    expect(createCommitUrl(remote)("abc123")).toBe(expected);
  });

  test.each([
    "https://github.com.example.org/owner/repo.git",
    "https://example.org/github.com/owner/repo.git",
    "not-a-url",
    "",
  ])("rejects unsupported remote %s", (url) => {
    expect(parseRemoteUrl(url)).toBeNull();
  });
});

describe("parsePrUrl", () => {
  test.each([
    ["https://github.com/owner/my.project/pull/42", "github", "owner", "my.project"],
    ["https://gitlab.com/group/subgroup/repo/-/merge_requests/42", "gitlab", "group/subgroup", "repo"],
    [
      "https://gitlab.com/group/subgroup/nested/repo/-/merge_requests/42/diffs",
      "gitlab",
      "group/subgroup/nested",
      "repo",
    ],
    ["https://bitbucket.org/owner/repo/pull-requests/42?tab=diff", "bitbucket", "owner", "repo"],
  ] as const)("parses %s", (url, provider, owner, repo) => {
    expect(parsePrUrl(url ?? "")).toEqual({ number: 42, owner, provider, repo });
  });

  test.each([
    "https://github.com.example.org/owner/repo/pull/42",
    "https://example.org/github.com/owner/repo/pull/42",
    "https://github.com/owner/repo/pull/42abc",
    "https://github.com/owner/repo/pull/0",
    "https://github.com/owner/repo/pull/99999999999999999999",
    "ssh://github.com/owner/repo/pull/42",
    "not-a-url",
  ])("rejects unrelated or malformed URL %s", (url) => {
    expect(parsePrUrl(url)).toBeNull();
  });
});
