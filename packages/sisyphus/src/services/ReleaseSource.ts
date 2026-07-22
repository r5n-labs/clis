import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { StoneJson } from "../domain";
import type { PackageRelease } from "../types";

const REGULAR_FILE_MODES = new Set(["100644", "100755"]);
const SYMLINK_MODE = "120000";
const GITLINK_MODE = "160000";
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

type TrackedSourceEntry = { kind: "tracked"; mode: string; objectId: string; path: string };

type UntrackedSourceEntry = { kind: "untracked"; path: string };

type SourceEntry = TrackedSourceEntry | UntrackedSourceEntry;

type ReleasePlan = {
  packages: Record<string, PackageRelease>;
  sourceHash: string;
  stoneIds: string[];
  timestamp: string;
};

export async function hashReleaseSource(sisyphusDir: string): Promise<string> {
  const rootResult = await Bun.$`git rev-parse --show-toplevel`.quiet();
  const repositoryRoot = resolve(rootResult.stdout.toString().trim());
  const metadataPath = resolve(repositoryRoot, sisyphusDir);
  const metadataRelativePath = relative(repositoryRoot, metadataPath);
  if (!metadataRelativePath || isOutsideRepository(metadataRelativePath)) {
    throw new Exit("Sisyphus directory is outside the repository", "Use a repository-relative sisyphusDir");
  }

  const metadataGitPath = metadataRelativePath.split(sep).join("/");
  const entries = await listSourceEntries(repositoryRoot, metadataGitPath);
  const sourceHash = createHash("sha256");

  for (const entry of entries) {
    if (entry.kind === "tracked" && !isSupportedMode(entry.mode)) {
      throw new Exit(`Release source has unsupported Git mode ${entry.mode}: ${entry.path}`);
    }

    const absolutePath = await resolveSourcePath(repositoryRoot, entry.path);
    const pathStatus = await lstatIfExists(absolutePath);
    sourceHash.update(entry.path);
    sourceHash.update("\0");
    if (!pathStatus) {
      if (entry.kind === "tracked" && entry.mode === GITLINK_MODE) {
        throw new Exit(`Release source gitlink is not initialized: ${entry.path}`);
      }
      sourceHash.update("deleted");
    } else if (entry.kind === "untracked" || REGULAR_FILE_MODES.has(entry.mode)) {
      if (!pathStatus.isFile() || pathStatus.isSymbolicLink()) {
        throw new Exit(`Release source path is not a regular file: ${entry.path}`);
      }
      await updateRegularFileHash(sourceHash, absolutePath, entry.path);
    } else if (entry.mode === SYMLINK_MODE) {
      if (!pathStatus.isSymbolicLink()) {
        throw new Exit(`Release source path does not match Git mode ${SYMLINK_MODE}: ${entry.path}`);
      }
      sourceHash.update(
        createHash("sha256")
          .update(await readlink(absolutePath, { encoding: "buffer" }))
          .digest(),
      );
      sourceHash.update(SYMLINK_MODE);
    } else {
      if (!pathStatus.isDirectory() || pathStatus.isSymbolicLink()) {
        throw new Exit(`Release source path does not match Git mode ${GITLINK_MODE}: ${entry.path}`);
      }
      sourceHash.update(await resolveGitlinkObjectId(repositoryRoot, absolutePath, entry));
      await validateReleaseCheckout(absolutePath);
      sourceHash.update(GITLINK_MODE);
    }
    sourceHash.update("\0");
  }

  return sourceHash.digest("hex");
}

export async function validateReleaseCheckout(
  cwd: string = process.cwd(),
  allowedChanges: readonly string[] = [],
): Promise<void> {
  const rootResult = await Bun.$`git rev-parse --show-toplevel`.cwd(cwd).quiet();
  const repositoryRoot = resolve(rootResult.stdout.toString().trim());
  await validateRepositoryCheckout(repositoryRoot, new Set(allowedChanges), "");
}

async function validateRepositoryCheckout(
  repositoryRoot: string,
  allowedChanges: ReadonlySet<string>,
  prefix: string,
): Promise<void> {
  const [indexResult, flagsResult] = await Promise.all([
    Bun.$`git ls-files --stage -z --cached`.cwd(repositoryRoot).quiet(),
    Bun.$`git ls-files -v -z --cached`.cwd(repositoryRoot).quiet(),
  ]);
  const paths = new Set<string>();
  const flags = new Map<string, string>();

  for (const record of splitNullTerminated(flagsResult.stdout.toString())) {
    const flag = record.slice(0, 1);
    const path = record.slice(2);
    if (!flag || record.slice(1, 2) !== " " || !path) {
      throw new Exit("Unable to parse Git index flags while validating release source");
    }
    flags.set(path, flag);
  }

  for (const record of splitNullTerminated(indexResult.stdout.toString())) {
    const entry = parseIndexEntry(record);
    if (entry.stage !== "0") {
      throw new Exit(`Release source has an unresolved index entry: ${entry.path}`);
    }
    if (paths.has(entry.path)) throw new Exit(`Release source has duplicate index entries: ${entry.path}`);
    paths.add(entry.path);
    if (flags.get(entry.path) !== "H") {
      throw new Exit(`Release source index flags hide working tree changes: ${entry.path}`);
    }

    const trackedEntry: TrackedSourceEntry = {
      kind: "tracked",
      mode: entry.mode,
      objectId: entry.objectId,
      path: entry.path,
    };
    const absolutePath = await resolveSourcePath(repositoryRoot, entry.path);
    const pathStatus = await lstatIfExists(absolutePath);
    if (!pathStatus) throw new Exit(`Release source path is missing: ${entry.path}`);
    const prefixedPath = `${prefix}${entry.path}`;
    if (allowedChanges.has(prefixedPath)) continue;

    if (REGULAR_FILE_MODES.has(entry.mode)) {
      if (!pathStatus.isFile() || pathStatus.isSymbolicLink()) {
        throw new Exit(`Release source path is not a regular file: ${entry.path}`);
      }
      const hashResult = await Bun.$`git hash-object ${`--path=${entry.path}`} ${absolutePath}`
        .cwd(repositoryRoot)
        .quiet();
      const objectId = hashResult.stdout.toString().trim();
      const mode = pathStatus.mode & 0o111 ? "100755" : "100644";
      if (objectId !== entry.objectId || mode !== entry.mode) {
        throw new Exit(`Release source path differs from the Git index: ${entry.path}`);
      }
      continue;
    }

    if (entry.mode === SYMLINK_MODE) {
      if (!pathStatus.isSymbolicLink()) {
        throw new Exit(`Release source path does not match Git mode ${SYMLINK_MODE}: ${entry.path}`);
      }
      const expectedTarget = await Bun.$`git cat-file blob ${entry.objectId}`.cwd(repositoryRoot).quiet();
      const actualTarget = await readlink(absolutePath, { encoding: "buffer" });
      if (!Buffer.from(expectedTarget.stdout).equals(actualTarget)) {
        throw new Exit(`Release source symlink differs from the Git index: ${entry.path}`);
      }
      continue;
    }

    if (entry.mode !== GITLINK_MODE) {
      throw new Exit(`Release source has unsupported Git mode ${entry.mode}: ${entry.path}`);
    }
    if (!pathStatus.isDirectory() || pathStatus.isSymbolicLink()) {
      throw new Exit(`Release source gitlink is not initialized: ${entry.path}`);
    }
    await resolveGitlinkObjectId(repositoryRoot, absolutePath, trackedEntry);
    await validateRepositoryCheckout(absolutePath, allowedChanges, `${prefixedPath}/`);
  }
}

export function hashReleasePlan(plan: ReleasePlan, stones: readonly StoneJson[]): string {
  const canonicalPlan = {
    packages: Object.fromEntries(Object.entries(plan.packages).sort(([left], [right]) => left.localeCompare(right))),
    sourceHash: plan.sourceHash,
    stoneIds: [...plan.stoneIds],
    stones: stones.map((stone) => canonicalize(stone)),
    timestamp: plan.timestamp,
  };
  return createHash("sha256").update(JSON.stringify(canonicalPlan)).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function isOutsideRepository(path: string): boolean {
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

async function listSourceEntries(repositoryRoot: string, metadataPath: string): Promise<SourceEntry[]> {
  const [indexResult, untrackedResult] = await Promise.all([
    Bun.$`git ls-files --stage -z --cached`.cwd(repositoryRoot).quiet(),
    Bun.$`git ls-files -z --others --exclude-standard`.cwd(repositoryRoot).quiet(),
  ]);
  const entries: SourceEntry[] = [];
  const paths = new Set<string>();

  for (const record of splitNullTerminated(indexResult.stdout.toString())) {
    const entry = parseIndexEntry(record);
    if (isMetadataPath(entry.path, metadataPath)) continue;
    if (entry.stage !== "0") {
      throw new Exit(`Release source has an unresolved index entry: ${entry.path}`);
    }
    if (paths.has(entry.path)) throw new Exit(`Release source has duplicate index entries: ${entry.path}`);
    paths.add(entry.path);
    entries.push({ kind: "tracked", mode: entry.mode, objectId: entry.objectId, path: entry.path });
  }

  for (const path of splitNullTerminated(untrackedResult.stdout.toString())) {
    if (isMetadataPath(path, metadataPath)) continue;
    if (paths.has(path)) throw new Exit(`Release source path is both tracked and untracked: ${path}`);
    paths.add(path);
    entries.push({ kind: "untracked", path });
  }

  return entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function splitNullTerminated(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function parseIndexEntry(record: string): { mode: string; objectId: string; path: string; stage: string } {
  const separatorIndex = record.indexOf("\t");
  if (separatorIndex < 0) throw new Exit("Unable to parse Git index entry while hashing release source");

  const [mode, objectId, stage, ...unexpected] = record.slice(0, separatorIndex).split(" ");
  const path = record.slice(separatorIndex + 1);
  if (
    !mode ||
    !/^[0-7]{6}$/.test(mode) ||
    !objectId ||
    !GIT_OBJECT_ID_PATTERN.test(objectId) ||
    !stage ||
    unexpected.length > 0 ||
    !path
  ) {
    throw new Exit("Unable to parse Git index entry while hashing release source");
  }
  return { mode, objectId, path, stage };
}

function isMetadataPath(path: string, metadataPath: string): boolean {
  return path === metadataPath || path.startsWith(`${metadataPath}/`);
}

function isSupportedMode(mode: string): boolean {
  return REGULAR_FILE_MODES.has(mode) || mode === SYMLINK_MODE || mode === GITLINK_MODE;
}

async function resolveSourcePath(repositoryRoot: string, path: string): Promise<string> {
  const parts = path.split("/");
  const absolutePath = resolve(repositoryRoot, path);
  const repositoryRelativePath = relative(repositoryRoot, absolutePath);
  if (
    parts.some((part) => !part || part === "." || part === "..") ||
    isOutsideRepository(repositoryRelativePath) ||
    repositoryRelativePath.split(sep).join("/") !== path
  ) {
    throw new Exit(`Release source path escapes the repository: ${path}`);
  }

  let parentPath = repositoryRoot;
  for (const part of parts.slice(0, -1)) {
    parentPath = resolve(parentPath, part);
    const parentStatus = await lstatIfExists(parentPath);
    if (!parentStatus) break;
    if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) {
      throw new Exit(`Release source path has an unsafe parent: ${path}`);
    }
  }
  return absolutePath;
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return null;
    throw error;
  }
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function updateRegularFileHash(sourceHash: ReturnType<typeof createHash>, path: string, displayPath: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error: unknown) => {
    if (isFileSystemError(error, "ELOOP")) {
      throw new Exit(`Release source path is not a regular file: ${displayPath}`);
    }
    throw error;
  });

  try {
    const status = await file.stat();
    if (!status.isFile()) throw new Exit(`Release source path is not a regular file: ${displayPath}`);
    sourceHash.update(
      createHash("sha256")
        .update(await file.readFile())
        .digest(),
    );
    sourceHash.update(status.mode & 0o111 ? "100755" : "100644");
  } finally {
    await file.close();
  }
}

async function resolveGitlinkObjectId(
  repositoryRoot: string,
  absolutePath: string,
  entry: TrackedSourceEntry,
): Promise<string> {
  const [topLevelResult, superprojectResult, gitDirectoryResult, modulesPathResult] = await Promise.all([
    Bun.$`git rev-parse --show-toplevel`.cwd(absolutePath).quiet(),
    Bun.$`git rev-parse --show-superproject-working-tree`.cwd(absolutePath).quiet(),
    Bun.$`git rev-parse --absolute-git-dir`.cwd(absolutePath).quiet(),
    Bun.$`git rev-parse --git-path modules`.cwd(repositoryRoot).quiet(),
  ]);
  const topLevel = resolve(topLevelResult.stdout.toString().trim());
  const superprojectOutput = superprojectResult.stdout.toString().trim();
  const superproject = superprojectOutput ? resolve(superprojectOutput) : null;
  const gitDirectory = resolve(gitDirectoryResult.stdout.toString().trim());
  const modulesRoot = resolve(repositoryRoot, modulesPathResult.stdout.toString().trim());
  const moduleRelativePath = relative(modulesRoot, gitDirectory);
  if (
    topLevel !== absolutePath ||
    superproject !== repositoryRoot ||
    !moduleRelativePath ||
    isOutsideRepository(moduleRelativePath)
  ) {
    throw new Exit(`Release source gitlink is not initialized: ${entry.path}`);
  }

  const statusResult = await Bun.$`git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none`
    .cwd(absolutePath)
    .quiet();
  if (statusResult.stdout.byteLength > 0) {
    throw new Exit(
      `Release source gitlink is dirty: ${entry.path}`,
      "Commit or discard submodule changes before releasing",
    );
  }

  const headResult = await Bun.$`git rev-parse --verify HEAD`.cwd(absolutePath).quiet();
  const objectId = headResult.stdout.toString().trim();
  if (!GIT_OBJECT_ID_PATTERN.test(objectId)) {
    throw new Exit(`Release source gitlink has an invalid object ID: ${entry.path}`);
  }
  if (objectId !== entry.objectId) {
    throw new Exit(
      `Release source gitlink does not match the recorded commit: ${entry.path}`,
      "Check out the submodule commit recorded by the repository before releasing",
    );
  }
  return entry.objectId;
}
