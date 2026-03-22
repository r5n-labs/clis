import { describe, expect, test } from "bun:test";

// Copied from src/services/GitRemoteParser.ts to test regex patterns directly,
// since parseUrl and the patterns are private/module-scoped.
const GITHUB_PATTERN = /github\.com[:/]([^/]+)\/([^/.]+)/;
const GITLAB_PATTERN = /gitlab\.com[:/]([^/]+)\/([^/.]+)/;
const BITBUCKET_PATTERN = /bitbucket\.org[:/]([^/]+)\/([^/.]+)/;

type Provider = "github" | "gitlab" | "bitbucket";

const PROVIDER_DOMAIN: Record<Provider, string> = {
	bitbucket: "bitbucket.org",
	github: "github.com",
	gitlab: "gitlab.com",
};

const COMMIT_PATH: Record<Provider, string> = {
	bitbucket: "commits",
	github: "commit",
	gitlab: "-/commit",
};

/** Mirrors the parseUrl logic from GitRemoteParser */
function parseUrl(url: string): {
	provider: Provider;
	owner: string;
	repo: string;
	commitUrl: (hash: string) => string;
} | null {
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
				return {
					commitUrl: (hash: string) => `${baseUrl}/${commitPath}/${hash}`,
					owner,
					provider,
					repo,
				};
			}
		}
	}

	return null;
}

describe("GitRemoteParser URL parsing", () => {
	describe("GitHub", () => {
		test("parses HTTPS URL with .git suffix", () => {
			const result = parseUrl("https://github.com/owner/repo.git");
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("github");
			expect(result!.owner).toBe("owner");
			expect(result!.repo).toBe("repo");
		});

		test("parses SSH URL", () => {
			const result = parseUrl("git@github.com:owner/repo.git");
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("github");
			expect(result!.owner).toBe("owner");
			expect(result!.repo).toBe("repo");
		});

		test("parses HTTPS URL without .git suffix", () => {
			const result = parseUrl("https://github.com/owner/repo");
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("github");
			expect(result!.owner).toBe("owner");
			expect(result!.repo).toBe("repo");
		});

		test("generates correct commit URL", () => {
			const result = parseUrl("https://github.com/owner/repo.git");
			expect(result!.commitUrl("abc123")).toBe(
				"https://github.com/owner/repo/commit/abc123",
			);
		});
	});

	describe("GitLab", () => {
		test("parses HTTPS URL with .git suffix", () => {
			const result = parseUrl("https://gitlab.com/owner/repo.git");
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("gitlab");
			expect(result!.owner).toBe("owner");
			expect(result!.repo).toBe("repo");
		});

		test("parses SSH URL", () => {
			const result = parseUrl("git@gitlab.com:owner/repo.git");
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("gitlab");
			expect(result!.owner).toBe("owner");
			expect(result!.repo).toBe("repo");
		});

		test("generates correct commit URL with -/commit path", () => {
			const result = parseUrl("https://gitlab.com/owner/repo.git");
			expect(result!.commitUrl("def456")).toBe(
				"https://gitlab.com/owner/repo/-/commit/def456",
			);
		});
	});

	describe("Bitbucket", () => {
		test("parses HTTPS URL with .git suffix", () => {
			const result = parseUrl("https://bitbucket.org/owner/repo.git");
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("bitbucket");
			expect(result!.owner).toBe("owner");
			expect(result!.repo).toBe("repo");
		});

		test("parses SSH URL", () => {
			const result = parseUrl("git@bitbucket.org:owner/repo.git");
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("bitbucket");
			expect(result!.owner).toBe("owner");
			expect(result!.repo).toBe("repo");
		});

		test("generates correct commit URL with commits path", () => {
			const result = parseUrl("https://bitbucket.org/owner/repo.git");
			expect(result!.commitUrl("789abc")).toBe(
				"https://bitbucket.org/owner/repo/commits/789abc",
			);
		});
	});

	describe("URL with credentials", () => {
		test("parses HTTPS URL containing user:token credentials", () => {
			const result = parseUrl(
				"https://user:token@github.com/owner/repo.git",
			);
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("github");
			expect(result!.owner).toBe("owner");
			expect(result!.repo).toBe("repo");
		});
	});

	describe("no match cases", () => {
		test("returns null for unknown host", () => {
			const result = parseUrl("https://sourcehut.org/owner/repo.git");
			expect(result).toBeNull();
		});

		test("returns null for malformed URL", () => {
			const result = parseUrl("not-a-url");
			expect(result).toBeNull();
		});

		test("returns null for empty string", () => {
			const result = parseUrl("");
			expect(result).toBeNull();
		});
	});

	describe("known bugs", () => {
		test("BUG: dots in repo names - captures only text before first dot", () => {
			// The regex [^/.] excludes dots, so "my.project.git" matches only "my"
			// instead of "my.project". This is a known limitation.
			const result = parseUrl("https://github.com/owner/my.project.git");
			expect(result).not.toBeNull();
			// Current (buggy) behavior: repo is "my" instead of "my.project"
			expect(result!.repo).toBe("my");
			// If fixed, this should be:
			// expect(result!.repo).toBe("my.project");
		});

		test("BUG: GitLab nested subgroups - captures group as owner, subgroup as repo", () => {
			// GitLab supports nested subgroups like gitlab.com/group/subgroup/repo
			// The regex only captures the first two path segments, so it gets
			// owner="group" and repo="subgroup" instead of the actual repo.
			const result = parseUrl(
				"https://gitlab.com/group/subgroup/repo.git",
			);
			expect(result).not.toBeNull();
			// Current (buggy) behavior: captures subgroup instead of repo
			expect(result!.owner).toBe("group");
			expect(result!.repo).toBe("subgroup");
			// If fixed, this should handle nested paths correctly:
			// expect(result!.repo).toBe("repo");
		});
	});
});
