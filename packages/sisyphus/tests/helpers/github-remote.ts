import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReleaseLedgerRemoteDestination } from "../../src/services/release-ledger";

const EXECUTABLE_MODE = 0o755;
const GITHUB_HOST = "git@github.com";

export const GITHUB_OWNER = "acme";
export const GITHUB_REPO = "widgets";
export const GITHUB_DESTINATION: ReleaseLedgerRemoteDestination = {
  canonicalUrl: `ssh://${GITHUB_HOST}/${GITHUB_OWNER}/${GITHUB_REPO}.git`,
  owner: GITHUB_OWNER,
  provider: "github",
  repo: GITHUB_REPO,
};

export type GitHubRemote = { env: Record<string, string | undefined>; ghCalls: () => string[][] };

export async function routeGitHubRemote(root: string, remote: string): Promise<GitHubRemote> {
  const bin = join(root, ".git/github-bin");
  const sshPath = join(root, ".git/github-ssh");
  const callsPath = join(root, ".git/gh-calls.jsonl");
  const globalConfig = join(root, ".git/global-gitconfig");
  const repositoryPath = `'${GITHUB_OWNER}/${GITHUB_REPO}.git'`;

  mkdirSync(bin, { recursive: true });
  writeFileSync(callsPath, "");
  writeFileSync(globalConfig, "");
  writeFileSync(
    sshPath,
    [
      "#!/bin/sh",
      'case "$1 $2" in',
      `  "${GITHUB_HOST} git-upload-pack ${repositoryPath}") exec git upload-pack ${JSON.stringify(remote)} ;;`,
      `  "${GITHUB_HOST} git-receive-pack ${repositoryPath}") exec git receive-pack ${JSON.stringify(remote)} ;;`,
      "esac",
      'echo "unexpected ssh invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    { mode: EXECUTABLE_MODE },
  );
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bun",
      'import { appendFileSync } from "node:fs";',
      "const args = process.argv.slice(2);",
      `appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n");`,
      'const handled = (args[0] === "auth" && args[1] === "status") || (args[0] === "release" && args[1] === "create");',
      "process.exit(handled ? 0 : 1);",
      "",
    ].join("\n"),
    { mode: EXECUTABLE_MODE },
  );

  await Bun.$`git remote set-url origin ${`${GITHUB_HOST}:${GITHUB_OWNER}/${GITHUB_REPO}.git`}`.cwd(root).quiet();
  await Bun.$`git config core.sshCommand ${sshPath}`.cwd(root).quiet();
  await Bun.$`git config ssh.variant simple`.cwd(root).quiet();

  return {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    },
    ghCalls: () =>
      readFileSync(callsPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
}
