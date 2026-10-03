import { Exit } from "@r5n/cli-core";
import type { GitSnapshot } from "../domain/source-target";

const GIT_SUCCESS = 0;
export const GIT_DIFFERENCES = 1;

async function executeGit(root: string, args: string[]) {
  const result = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ]);
  return { stdout, stderr, code };
}

export async function git(root: string, args: string[], acceptedCode = GIT_SUCCESS): Promise<string> {
  const { stdout, stderr, code } = await executeGit(root, args);
  if (code !== GIT_SUCCESS && code !== acceptedCode) throw new Exit(`Cannot collect changes: ${stderr.trim()}`);
  return stdout;
}

export async function captureGitSnapshot(root: string, base: string): Promise<GitSnapshot> {
  const commit = (await git(root, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`])).trim();
  const [prefix, entries, others, fileMode, changed] = await Promise.all([
    git(root, ["rev-parse", "--show-prefix"]),
    git(root, ["ls-files", "--stage", "-t", "-z"]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    git(root, ["config", "--bool", "--get", "core.filemode"], GIT_DIFFERENCES),
    git(root, [
      "diff",
      "--relative",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--name-only",
      "-z",
      commit,
      "--",
      ".",
    ]),
  ]);
  const tracked = new Map<string, string>();
  const skipWorktree = new Set<string>();
  for (const record of entries.split("\0")) {
    const match = /^(\w) (\d+) [a-f0-9]+ \d\t([\s\S]+)$/.exec(record);
    if (!match?.[2] || !match[3]) continue;
    tracked.set(match[3], match[2]);
    if (match[1] === "S") skipWorktree.add(match[3]);
  }
  return {
    commit,
    prefix: prefix.replace(/\n$/, ""),
    changed: new Set(changed.split("\0").filter(Boolean)),
    tracked,
    untracked: new Set(others.split("\0").filter(Boolean)),
    skipWorktree,
    honourFileMode: fileMode.trim() !== "false",
  };
}
