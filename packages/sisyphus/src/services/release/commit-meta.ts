import { dirname, join } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { Package, Stone } from "../../domain";
import type { ChangelogConfig, CommitConfig } from "../../types";

export function formatCommitMessage(template: string, stone: Stone, packages: Package[]): string {
  const packageList = packages.map((pkg) => `- ${pkg.name}@${pkg.newVersion ?? pkg.version}`).join("\n");

  const subject = template
    .replace("{message}", () => stone.message)
    .replace("{packages}", () => packages.map((pkg) => pkg.name).join(", "));

  return `${subject}\n\n${packageList}`;
}

export function getCommitAuthorArg(commit: CommitConfig): string[] {
  const { author, email } = commit;
  const normalizedAuthor = author.trim();
  const normalizedEmail = email?.trim() ?? "";

  if (!normalizedAuthor && !normalizedEmail) return [];
  if (!normalizedAuthor || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(normalizedEmail)) {
    throw new Exit("Invalid release commit author", "Set valid commit.author and commit.email");
  }

  return ["--author", `${normalizedAuthor} <${normalizedEmail}>`];
}

export function getCommitterEnv(commit: CommitConfig): Record<string, string> {
  const { author, email } = commit;
  const env = { ...process.env } as Record<string, string>;
  if (!author) return env;

  env.GIT_COMMITTER_NAME = author;
  if (email) env.GIT_COMMITTER_EMAIL = email;
  return env;
}

export function getChangelogFiles(changelog: ChangelogConfig, packages: Package[]): string[] {
  const { filename, root } = changelog;
  const files = packages.map((pkg) => join(dirname(pkg.file), filename));
  if (root) files.push(filename);
  return files;
}
