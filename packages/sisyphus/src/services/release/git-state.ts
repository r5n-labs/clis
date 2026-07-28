import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Exit } from "@r5n/cli-core";
import { isEscapingPath, validateReleaseCheckout } from "../ReleaseSource";
import { runInContext } from "./run";

export function toLiteralPathspec(path: string): string {
  return `:(top,literal)${path}`;
}

export async function getHeadCommit(): Promise<string> {
  const result = await runInContext(() => Bun.$`git rev-parse HEAD`.quiet(), "Failed to resolve release commit");
  const commit = result.stdout.toString().trim();
  if (!commit) throw new Error("Release commit is empty");
  return commit;
}

export async function getHeadReference(): Promise<string | null> {
  const result = await Bun.$`git symbolic-ref -q HEAD`.quiet().nothrow();
  if (result.exitCode === 1) return null;
  if (result.exitCode !== 0) throw new Exit("Failed to resolve the current Git reference");
  return result.stdout.toString().trim() || null;
}

export async function resolveRef(ref: string): Promise<string | null> {
  const result = await Bun.$`git rev-parse --verify ${ref}`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim() || null;
}

export async function getOwnedMutationFingerprint(paths: readonly string[]): Promise<string> {
  const pathspecs = paths.map((path) => toLiteralPathspec(path));
  const [status, staged, unstaged] = await Promise.all([
    Bun.$`git status --porcelain=v1 -z --untracked-files=all -- ${pathspecs}`.quiet(),
    Bun.$`git diff --cached --binary --no-ext-diff -- ${pathspecs}`.quiet(),
    Bun.$`git diff --binary --no-ext-diff -- ${pathspecs}`.quiet(),
  ]);
  const hash = createHash("sha256");
  for (const output of [status.stdout, staged.stdout, unstaged.stdout]) {
    hash.update(String(output.length));
    hash.update("\0");
    hash.update(output);
  }
  return hash.digest("hex");
}

export function normalizeOwnedPath(repositoryRoot: string, path: string): string {
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path);
  const repositoryRelativePath = relative(repositoryRoot, absolutePath);
  if (!repositoryRelativePath || isEscapingPath(repositoryRelativePath)) {
    throw new Exit(`Release-owned path is outside the repository: ${path}`);
  }

  return repositoryRelativePath.split(sep).join("/");
}

export async function validateOwnedPaths(paths: readonly string[], repositoryRoot: string): Promise<void> {
  const realRepositoryRoot = await realpath(repositoryRoot);

  for (const path of paths) {
    const absolutePath = resolve(repositoryRoot, path);
    const pathStatus = await lstat(absolutePath).catch(() => null);
    if (pathStatus?.isSymbolicLink()) {
      throw new Exit(`Release-owned path is a symbolic link: ${path}`);
    }

    const existingPath = pathStatus ? absolutePath : dirname(absolutePath);
    const realExistingPath = await realpath(existingPath);
    if (isEscapingPath(relative(realRepositoryRoot, realExistingPath))) {
      throw new Exit(`Release-owned path escapes the repository: ${path}`);
    }
  }
}

export async function unstageOwnedPaths(ownedPaths: string[]): Promise<void> {
  const pathspecs = ownedPaths.map((path) => toLiteralPathspec(path));
  await runInContext(
    () => Bun.$`git reset --quiet HEAD -- ${pathspecs}`.quiet(),
    "Failed to unstage release-owned files",
  );
}

export async function validatePublishSources(repositoryRoot: string): Promise<void> {
  const status = await getPublishSourceStatus(repositoryRoot);
  if (status.length === 0) return;

  throw new Exit(
    "Repository source files changed after the release commit",
    "Commit or stash all source changes before preparing npm artifacts",
  );
}

export async function getPublishSourceStatus(repositoryRoot: string): Promise<Buffer> {
  await validateReleaseCheckout(repositoryRoot);
  const result = await runInContext(
    () =>
      Bun.$`git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none`.cwd(repositoryRoot).quiet(),
    "Failed to inspect release source files",
  );
  return result.stdout;
}

export async function updateRollbackRefs(
  createdCommit: { baseCommit: string; oid: string; ref: string | null } | null,
  createdTags: readonly string[],
  createdTagTargets: ReadonlyMap<string, string>,
  repositoryRoot: () => Promise<string>,
): Promise<void> {
  const commands: string[] = [];
  if (createdCommit) {
    commands.push(`update ${createdCommit.ref ?? "HEAD"} ${createdCommit.baseCommit} ${createdCommit.oid}`);
  }
  for (const tag of createdTags) {
    const target = createdTagTargets.get(tag);
    if (!target) throw new Error(`Missing rollback target for release tag ${tag}`);
    commands.push(`delete refs/tags/${tag} ${target}`);
  }
  if (commands.length === 0) return;

  const root = await repositoryRoot();
  const input = Buffer.from(["start", ...commands, "prepare", "commit", ""].join("\n"));
  await runInContext(async () => {
    const subprocess = Bun.spawn(["git", "update-ref", "--stdin"], {
      cwd: root,
      stderr: "pipe",
      stdin: input,
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stderr).text()]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `git update-ref exited with code ${exitCode}`);
  }, "Failed to atomically restore release refs");
}
