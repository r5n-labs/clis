import { describe, expect, test } from "bun:test";
import { describeGitHubTarget, parseGitHubUrl } from "../src/providers/github-url";

describe("parseGitHubUrl", () => {
  test("parses a repository URL", () => {
    expect(parseGitHubUrl("https://github.com/r5n-labs/clis")).toEqual({
      kind: "repo",
      owner: "r5n-labs",
      repo: "clis",
    });
  });

  test("strips a trailing .git from the repository", () => {
    expect(parseGitHubUrl("https://github.com/r5n-labs/clis.git")).toEqual({
      kind: "repo",
      owner: "r5n-labs",
      repo: "clis",
    });
  });

  test("keeps dots inside the repository name", () => {
    expect(parseGitHubUrl("https://github.com/owner/my.repo")).toEqual({
      kind: "repo",
      owner: "owner",
      repo: "my.repo",
    });
  });

  test("handles trailing slashes", () => {
    expect(parseGitHubUrl("https://github.com/r5n-labs/clis/")).toEqual({
      kind: "repo",
      owner: "r5n-labs",
      repo: "clis",
    });
    expect(parseGitHubUrl("https://github.com/r5n-labs/")).toEqual({ kind: "org", org: "r5n-labs" });
  });

  test("ignores query strings and fragments", () => {
    expect(parseGitHubUrl("https://github.com/r5n-labs/clis?tab=readme")).toEqual({
      kind: "repo",
      owner: "r5n-labs",
      repo: "clis",
    });
    expect(parseGitHubUrl("https://github.com/r5n-labs#section")).toEqual({ kind: "org", org: "r5n-labs" });
  });

  test("parses an organization URL", () => {
    expect(parseGitHubUrl("https://github.com/r5n-labs")).toEqual({ kind: "org", org: "r5n-labs" });
  });

  test("accepts http URLs", () => {
    expect(parseGitHubUrl("http://github.com/r5n-labs/clis")).toEqual({
      kind: "repo",
      owner: "r5n-labs",
      repo: "clis",
    });
  });

  test("accepts the www subdomain", () => {
    expect(parseGitHubUrl("https://www.github.com/r5n-labs")).toEqual({ kind: "org", org: "r5n-labs" });
  });

  test("rejects an empty string", () => {
    expect(() => parseGitHubUrl("")).toThrow("Invalid GitHub URL");
  });

  test("rejects non-URL input", () => {
    expect(() => parseGitHubUrl("r5n-labs/clis")).toThrow("Invalid GitHub URL");
  });

  test("rejects non-github hosts", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/r5n-labs/clis")).toThrow("host must be github.com");
    expect(() => parseGitHubUrl("https://github.com.evil.com/r5n-labs/clis")).toThrow("host must be github.com");
  });

  test("rejects non-http protocols", () => {
    expect(() => parseGitHubUrl("ssh://github.com/r5n-labs/clis")).toThrow("expected http(s)");
  });

  test("rejects URLs with no path", () => {
    expect(() => parseGitHubUrl("https://github.com")).toThrow("Invalid GitHub URL");
    expect(() => parseGitHubUrl("https://github.com/")).toThrow("Invalid GitHub URL");
  });

  test("rejects deep paths instead of silently reducing them", () => {
    expect(() => parseGitHubUrl("https://github.com/a/b/c")).toThrow("Invalid GitHub URL");
    expect(() => parseGitHubUrl("https://github.com/r5n-labs/clis/tree/develop")).toThrow("Invalid GitHub URL");
  });

  test("includes the offending URL in the error message", () => {
    expect(() => parseGitHubUrl("https://example.com/foo")).toThrow("https://example.com/foo");
  });
});

describe("describeGitHubTarget", () => {
  test("describes a repository target", () => {
    expect(describeGitHubTarget({ kind: "repo", owner: "r5n-labs", repo: "clis" })).toBe("r5n-labs/clis");
  });

  test("describes an organization target", () => {
    expect(describeGitHubTarget({ kind: "org", org: "r5n-labs" })).toBe("r5n-labs");
  });
});
