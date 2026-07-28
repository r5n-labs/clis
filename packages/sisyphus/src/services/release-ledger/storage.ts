import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, rename, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isEscapingPath } from "../ReleaseSource";
import type { LedgerPaths, ReleaseLedgerData } from "./types";
import { errorDetail, FULL_GIT_OID_PATTERN, isErrorCode, ReleaseLedgerError, validateReleaseId } from "./types";
import { acquireLedgerWriteLock, releaseLedgerWriteLock, syncPath } from "./write-lock";

export async function resolveLedgerPaths(cwd: string): Promise<LedgerPaths> {
  const absoluteCwd = resolve(cwd);
  const rootResult = await Bun.$`git rev-parse --show-toplevel`.cwd(absoluteCwd).quiet().nothrow();
  if (rootResult.exitCode !== 0) {
    throw new ReleaseLedgerError(
      `Failed to resolve repository root from ${absoluteCwd}: ${rootResult.stderr.toString().trim() || "git exited unsuccessfully"}`,
    );
  }

  const rootOutput = rootResult.stdout.toString().trim();
  if (!rootOutput)
    throw new ReleaseLedgerError(`Failed to resolve repository root from ${absoluteCwd}: empty git output`);
  const repositoryRoot = isAbsolute(rootOutput) ? resolve(rootOutput) : resolve(absoluteCwd, rootOutput);
  const pathResult = await Bun.$`git rev-parse --git-path sisyphus/release`.cwd(repositoryRoot).quiet().nothrow();
  if (pathResult.exitCode !== 0) {
    throw new ReleaseLedgerError(
      `Failed to resolve release ledger git path from ${repositoryRoot}: ${pathResult.stderr.toString().trim() || "git exited unsuccessfully"}`,
    );
  }

  const pathOutput = pathResult.stdout.toString().trim();
  if (!pathOutput)
    throw new ReleaseLedgerError(`Failed to resolve release ledger git path from ${repositoryRoot}: empty git output`);
  const releaseDirectory = isAbsolute(pathOutput) ? resolve(pathOutput) : resolve(repositoryRoot, pathOutput);

  return {
    activePath: join(releaseDirectory, "active.json"),
    artifactsRoot: join(releaseDirectory, "artifacts"),
    historyDirectory: join(releaseDirectory, "history"),
    releaseDirectory,
    removingPath: join(releaseDirectory, "removing.json"),
    repositoryRoot,
  };
}

export async function resolveCommitTree(repositoryRoot: string, commit: string): Promise<string> {
  const treeish = `${commit}^{tree}`;
  const result = await Bun.$`git rev-parse ${treeish}`.cwd(repositoryRoot).quiet().nothrow();
  const tree = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !FULL_GIT_OID_PATTERN.test(tree)) {
    throw new ReleaseLedgerError(`Cannot resolve release tree for commit ${commit}`);
  }
  return tree;
}

export async function ensureLedgerStorage(paths: LedgerPaths, id: string): Promise<void> {
  await mkdir(paths.releaseDirectory, { recursive: true });
  await assertDirectory(paths.releaseDirectory, "release directory");
  await mkdir(paths.artifactsRoot, { recursive: true });
  await assertDirectory(paths.artifactsRoot, "artifacts root");
  await mkdir(getArtifactsDirectory(paths, id), { recursive: true });
  await assertArtifactStorage(paths, id);
}

async function assertArtifactStorage(paths: LedgerPaths, id: string): Promise<string> {
  const artifactsDirectory = getArtifactsDirectory(paths, id);
  await assertDirectory(paths.releaseDirectory, "release directory");
  await assertDirectory(paths.artifactsRoot, "artifacts root");
  await assertDirectory(artifactsDirectory, `artifacts directory for release ${id}`);
  const realRelease = await realpath(paths.releaseDirectory);
  const realArtifactsRoot = await realpath(paths.artifactsRoot);
  const realArtifacts = await realpath(artifactsDirectory);
  assertContained(realRelease, realArtifactsRoot, "Artifacts root escapes the release directory");
  assertContained(realArtifactsRoot, realArtifacts, `Artifacts directory for release ${id} escapes the artifacts root`);
  return realArtifacts;
}

export async function ensureHistoryDirectory(paths: LedgerPaths): Promise<void> {
  await assertDirectory(paths.releaseDirectory, "release directory");
  await mkdir(paths.historyDirectory, { recursive: true });
  await assertDirectory(paths.historyDirectory, "history directory");
  const realRelease = await realpath(paths.releaseDirectory);
  const realHistory = await realpath(paths.historyDirectory);
  assertContained(realRelease, realHistory, "History directory escapes the release directory");
}

export async function validateArtifactFiles(data: ReleaseLedgerData, paths: LedgerPaths): Promise<void> {
  for (const [packageName, artifact] of Object.entries(data.artifacts)) {
    const artifactPath = resolve(paths.releaseDirectory, artifact.path);
    await assertArtifactPathSafe(paths, data.id, artifactPath);
    const integrity = await calculateIntegrity(artifactPath);
    if (integrity !== artifact.integrity) {
      throw new ReleaseLedgerError(`Invalid release ledger artifact for ${packageName}: sha512 integrity mismatch`);
    }
  }
}

export async function validatePackageFiles(data: ReleaseLedgerData, paths: LedgerPaths): Promise<void> {
  const realRepositoryRoot = await realpath(paths.repositoryRoot);

  for (const pkg of data.packages) {
    const packagePath = resolve(paths.repositoryRoot, pkg.file);
    let packageStat: Awaited<ReturnType<typeof lstat>>;
    try {
      packageStat = await lstat(packagePath);
    } catch (error) {
      throw new ReleaseLedgerError(`Invalid package manifest for ${pkg.name} at ${pkg.file}: ${errorDetail(error)}`);
    }
    if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
      throw new ReleaseLedgerError(`Invalid package manifest for ${pkg.name} at ${pkg.file}: expected a regular file`);
    }

    const realPackagePath = await realpath(packagePath);
    assertContained(
      realRepositoryRoot,
      realPackagePath,
      `Package manifest for ${pkg.name} escapes the repository: ${pkg.file}`,
    );
  }
}

export async function assertArtifactPathSafe(paths: LedgerPaths, id: string, artifactPath: string): Promise<void> {
  const realArtifacts = await assertArtifactStorage(paths, id);
  let artifactStat: Awaited<ReturnType<typeof lstat>>;
  try {
    artifactStat = await lstat(artifactPath);
  } catch (error) {
    throw new ReleaseLedgerError(`Invalid release artifact at ${artifactPath}: ${errorDetail(error)}`);
  }
  if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
    throw new ReleaseLedgerError(`Invalid release artifact at ${artifactPath}: expected a regular file`);
  }
  const realArtifact = await realpath(artifactPath);
  assertContained(realArtifacts, realArtifact, `Release artifact escapes artifacts directory: ${artifactPath}`);
}

export async function atomicWriteJson(
  path: string,
  data: ReleaseLedgerData,
  overwrite: boolean,
  expectedUpdatedAt?: string,
): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = join(dirname(path), `.${randomUUID()}.json.tmp`);
  const lock = await acquireLedgerWriteLock(dirname(path));

  try {
    await assertDirectory(dirname(path), "release directory");
    if (overwrite) {
      await assertRegularFile(path, "active release ledger");
      let current: { updatedAt?: unknown };
      try {
        current = JSON.parse(await readFile(path, "utf-8")) as { updatedAt?: unknown };
      } catch (error) {
        throw new ReleaseLedgerError(
          `Failed to read active release ledger at ${path} before writing: ${errorDetail(error)}`,
        );
      }
      if (current.updatedAt !== expectedUpdatedAt) {
        throw new ReleaseLedgerError("Active release ledger changed in another process");
      }
    }

    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (overwrite) {
      await rename(tempPath, path);
    } else {
      try {
        await link(tempPath, path);
      } catch (error) {
        if (isErrorCode(error, "EEXIST")) {
          throw new ReleaseLedgerError(`Cannot create release ledger: active ledger already exists at ${path}`);
        }
        throw error;
      }
      await unlink(tempPath);
    }
    await syncPath(dirname(path));
  } catch (error) {
    await cleanupAfterFailure(tempPath, error, `Failed to clean temporary ledger file at ${tempPath}`);
  } finally {
    await releaseLedgerWriteLock(lock);
  }
}

export async function cleanupAfterFailure(path: string, error: unknown, message: string): Promise<never> {
  try {
    await rm(path, { force: true });
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], message);
  }
  throw error;
}

export async function calculateIntegrity(path: string): Promise<string> {
  let content: Buffer;
  try {
    content = await readFile(path);
  } catch (error) {
    throw new ReleaseLedgerError(`Failed to read release artifact at ${path}: ${errorDetail(error)}`);
  }
  return `sha512-${createHash("sha512").update(content).digest("base64")}`;
}

async function assertDirectory(path: string, label: string): Promise<void> {
  let pathStat: Awaited<ReturnType<typeof lstat>>;
  try {
    pathStat = await lstat(path);
  } catch (error) {
    throw new ReleaseLedgerError(`Invalid ${label} at ${path}: ${errorDetail(error)}`);
  }
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
    throw new ReleaseLedgerError(`Invalid ${label} at ${path}: expected a real directory`);
  }
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  let pathStat: Awaited<ReturnType<typeof lstat>>;
  try {
    pathStat = await lstat(path);
  } catch (error) {
    throw new ReleaseLedgerError(`Invalid ${label} at ${path}: ${errorDetail(error)}`);
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new ReleaseLedgerError(`Invalid ${label} at ${path}: expected a regular file`);
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

export function getArtifactsDirectory(paths: LedgerPaths, id: string): string {
  return resolve(paths.artifactsRoot, validateReleaseId(id, "id"));
}

export function getArtifactPath(paths: LedgerPaths, id: string, packageName: string): string {
  const filename = `${createHash("sha256").update(packageName).digest("hex")}.tgz`;
  return resolve(getArtifactsDirectory(paths, id), filename);
}

export function getArtifactRelativePath(paths: LedgerPaths, id: string, packageName: string): string {
  return relative(paths.releaseDirectory, getArtifactPath(paths, id, packageName))
    .split(sep)
    .join("/");
}

export function getHistoryPath(paths: LedgerPaths, id: string): string {
  const path = resolve(paths.historyDirectory, `${validateReleaseId(id, "id")}.json`);
  if (dirname(path) !== resolve(paths.historyDirectory)) {
    throw new ReleaseLedgerError(`Invalid release history path for ID ${id}`);
  }
  return path;
}

function assertContained(base: string, candidate: string, message: string): void {
  const path = relative(base, candidate);
  if (!path || isEscapingPath(path)) throw new ReleaseLedgerError(message);
}
