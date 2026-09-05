import { lstat, readlink, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { $ } from "bun";
import { resolveNpmAccess } from "./npm-access";
import { inferNpmPrereleaseTag } from "./npm-tag";

type PublishArtifactOptions = { cwd?: string; dryRun?: boolean };

type PackageSourceState = { commit: string; manifestPath: string; repositoryRoot: string };

type ManifestRestoration = {
  manifestPath: string;
  originalManifest: string;
  packageDir: string;
  preparedManifest: string | null;
};

const GITLINK_MODE = "160000";
const GIT_INDEX_MODE_PATTERN = /^[0-7]{6}$/;
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TAR_BLOCK_SIZE = 512;
const TAR_NAME_LENGTH = 100;
const TAR_SIZE_OFFSET = 124;
const TAR_SIZE_LENGTH = 12;
const TAR_PREFIX_OFFSET = 345;
const TAR_PREFIX_LENGTH = 155;
const PACKED_MANIFEST_PATH = "package/package.json";

export type NpmPackEntry = { files?: unknown; filename?: unknown; name?: unknown; version?: unknown };

export function parseNpmPackOutput(stdout: string): NpmPackEntry | undefined {
  const parsed: unknown = JSON.parse(stdout);
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed)
      : [];
  const [entry] = entries;
  return typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as NpmPackEntry) : undefined;
}

export async function preparePackageArtifact(packageDir: string, artifactPath: string): Promise<void> {
  const pkgDir = await realpath(resolve(packageDir));
  const pkgJsonPath = resolve(pkgDir, "package.json");
  const resolvedArtifactPath = resolve(artifactPath);
  const manifestStat = await lstat(pkgJsonPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error(`Package manifest is not a regular file: ${pkgJsonPath}`);
  }
  const sourceState = await readCleanPackageSource(pkgDir, pkgJsonPath);
  const originalManifest = await Bun.file(pkgJsonPath).text();
  const originalIdentity = readPackageIdentity(originalManifest, packageDir);
  let artifactCreated = false;
  let preparedManifest: string | null = null;
  let preparationError: unknown;

  try {
    await $`bun run package:prepare`.cwd(pkgDir);
    preparedManifest = await Bun.file(pkgJsonPath).text();
    const preparedIdentity = readPackageIdentity(preparedManifest, packageDir);
    if (preparedIdentity.name !== originalIdentity.name || preparedIdentity.version !== originalIdentity.version) {
      throw new Error(
        `Prepared package identity changed from ${originalIdentity.name}@${originalIdentity.version} to ${preparedIdentity.name}@${preparedIdentity.version}`,
      );
    }
    await validatePreparedPackageSource(sourceState);
    const artifactDirectory = dirname(resolvedArtifactPath);
    const result = await $`npm pack --ignore-scripts --json --pack-destination ${artifactDirectory}`
      .cwd(pkgDir)
      .quiet();
    const packed = parseNpmPackOutput(result.stdout.toString());
    if (
      typeof packed?.filename !== "string" ||
      !packed.filename ||
      typeof packed.name !== "string" ||
      !packed.name ||
      typeof packed.version !== "string" ||
      !packed.version
    ) {
      throw new Error("npm pack did not return a valid artifact identity");
    }
    const generatedPath = resolve(artifactDirectory, packed.filename);
    const artifactRelativePath = relative(artifactDirectory, generatedPath);
    if (
      artifactRelativePath === ".." ||
      artifactRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(artifactRelativePath)
    ) {
      throw new Error("npm pack returned an artifact outside the destination directory");
    }
    if (generatedPath !== resolvedArtifactPath) await rename(generatedPath, resolvedArtifactPath);
    artifactCreated = true;
    if (packed.name !== originalIdentity.name || packed.version !== originalIdentity.version) {
      throw new Error(
        `Packed artifact identity changed from ${originalIdentity.name}@${originalIdentity.version} to ${packed.name}@${packed.version}`,
      );
    }
    if (!sameJsonDocument(preparedManifest, await readPackedManifest(resolvedArtifactPath))) {
      throw new Error("Packed manifest does not match the prepared package manifest");
    }
    await validatePreparedPackageSource(sourceState);
  } catch (error) {
    preparationError = error;
  }

  const restorationError = await restorePackageManifest({
    manifestPath: pkgJsonPath,
    originalManifest,
    packageDir,
    preparedManifest,
  });

  if (preparationError === undefined && restorationError === undefined) return;

  let cleanupError: unknown;
  if (artifactCreated) {
    try {
      await rm(resolvedArtifactPath, { force: true });
    } catch (error) {
      cleanupError = error;
    }
  }

  const failures = [preparationError, restorationError, cleanupError].filter((failure) => failure !== undefined);
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, `Failed to prepare and restore ${packageDir}`);
}

async function restorePackageManifest(restoration: ManifestRestoration): Promise<unknown> {
  const { manifestPath, originalManifest, packageDir, preparedManifest } = restoration;
  let currentManifest: string;

  try {
    currentManifest = await Bun.file(manifestPath).text();
  } catch (readError) {
    try {
      await Bun.write(manifestPath, originalManifest);
      return undefined;
    } catch (writeError) {
      return new AggregateError([readError, writeError], `Failed to restore the package manifest at ${manifestPath}`);
    }
  }

  try {
    if (preparedManifest !== null && currentManifest !== preparedManifest) {
      throw new Error(
        `Package manifest changed concurrently while preparing ${packageDir}, so ${manifestPath} was left as written by the concurrent change. Recover the committed manifest with: git restore -- ${manifestPath}`,
      );
    }
    if (currentManifest !== originalManifest) await Bun.write(manifestPath, originalManifest);
    return undefined;
  } catch (error) {
    return error;
  }
}

async function readPackedManifest(artifactPath: string): Promise<string> {
  const compressed = new Uint8Array(await Bun.file(artifactPath).arrayBuffer());
  const archive = Bun.gunzipSync(compressed);
  const decoder = new TextDecoder();

  for (let offset = 0; offset + TAR_BLOCK_SIZE <= archive.length; ) {
    const name = readTarString(archive, offset, TAR_NAME_LENGTH, decoder);
    if (!name) break;
    const prefix = readTarString(archive, offset + TAR_PREFIX_OFFSET, TAR_PREFIX_LENGTH, decoder);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = readTarString(archive, offset + TAR_SIZE_OFFSET, TAR_SIZE_LENGTH, decoder).trim();
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid tar entry size for ${path}`);
    const contentOffset = offset + TAR_BLOCK_SIZE;
    const contentEnd = contentOffset + size;
    if (contentEnd > archive.length) throw new Error(`Truncated tar entry for ${path}`);
    if (path === PACKED_MANIFEST_PATH) return decoder.decode(archive.subarray(contentOffset, contentEnd));
    offset = contentOffset + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }

  throw new Error("Packed artifact does not contain package/package.json");
}

function readTarString(archive: Uint8Array, offset: number, length: number, decoder: TextDecoder): string {
  const field = archive.subarray(offset, offset + length);
  const terminator = field.indexOf(0);
  return decoder.decode(terminator < 0 ? field : field.subarray(0, terminator));
}

function sameJsonDocument(first: string, second: string): boolean {
  return JSON.stringify(canonicalizeJson(JSON.parse(first))) === JSON.stringify(canonicalizeJson(JSON.parse(second)));
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  );
}

async function readCleanPackageSource(packageDirectory: string, manifestPath: string): Promise<PackageSourceState> {
  const repositoryRoot = await realpath(
    (await $`git rev-parse --show-toplevel`.cwd(packageDirectory).quiet()).stdout.toString().trim(),
  );
  const commit = (await $`git rev-parse HEAD`.cwd(repositoryRoot).quiet()).stdout.toString().trim();
  const status = await readPackageSourceStatus(repositoryRoot);
  if (status.length > 0) {
    throw new Error("Repository source files must be clean before preparing a package artifact");
  }
  await validateIgnoredBuildInputs(repositoryRoot);

  const repositoryRelativeManifest = relative(repositoryRoot, manifestPath);
  if (
    repositoryRelativeManifest === ".." ||
    repositoryRelativeManifest.startsWith(`..${sep}`) ||
    isAbsolute(repositoryRelativeManifest)
  ) {
    throw new Error(`Package manifest is outside the repository: ${manifestPath}`);
  }
  await validateExistingPackInputs(packageDirectory, repositoryRoot);
  return { commit, manifestPath: repositoryRelativeManifest.split(sep).join("/"), repositoryRoot };
}

async function validateIgnoredBuildInputs(repositoryRoot: string, prefix = ""): Promise<void> {
  const [ignoredResult, indexResult] = await Promise.all([
    $`git ls-files --others --ignored --exclude-standard -z`.cwd(repositoryRoot).quiet(),
    $`git ls-files --stage -z --cached`.cwd(repositoryRoot).quiet(),
  ]);
  const ignoredInputs = ignoredResult.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.split("/").includes("node_modules"));
  if (ignoredInputs.length > 0) {
    throw new Error(
      [
        "Repository contains ignored build inputs outside node_modules:",
        ...ignoredInputs.map((path) => `  ${prefix}${path}`),
        "Remove them or publish from a pristine worktree (git worktree add ../publish)",
      ].join("\n"),
    );
  }

  for (const record of indexResult.stdout.toString().split("\0").filter(Boolean)) {
    const { mode, path } = parseIndexRecord(record);
    if (mode === GITLINK_MODE) {
      await validateIgnoredBuildInputs(resolve(repositoryRoot, path), `${prefix}${path}/`);
    }
  }
}

async function validatePreparedPackageSource(source: PackageSourceState): Promise<void> {
  const commit = (await $`git rev-parse HEAD`.cwd(source.repositoryRoot).quiet()).stdout.toString().trim();
  const status = await readPackageSourceStatus(source.repositoryRoot, [source.manifestPath]);
  const expectedManifestChange = ` M ${source.manifestPath}`;
  if (
    commit === source.commit &&
    (status.length === 0 || (status.length === 1 && status[0] === expectedManifestChange))
  ) {
    return;
  }

  throw new Error("Package preparation changed repository source files outside the publish manifest");
}

async function readPackageSourceStatus(
  repositoryRoot: string,
  allowedChanges: readonly string[] = [],
): Promise<string[]> {
  await validateRepositoryCheckout(repositoryRoot, new Set(allowedChanges), "");
  const result = await $`git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none`
    .cwd(repositoryRoot)
    .quiet();
  return result.stdout.toString().split("\0").filter(Boolean);
}

async function validateExistingPackInputs(packageDirectory: string, repositoryRoot: string): Promise<void> {
  const [packResult, trackedPaths] = await Promise.all([
    $`npm pack --dry-run --ignore-scripts --json`.cwd(packageDirectory).quiet(),
    collectTrackedPaths(repositoryRoot),
  ]);
  const files = parseNpmPackOutput(packResult.stdout.toString())?.files;
  if (!Array.isArray(files)) throw new Error("npm pack did not return a package file list");

  for (const file of files) {
    if (typeof file !== "object" || file === null || Array.isArray(file) || !("path" in file)) {
      throw new Error("npm pack returned an invalid package file entry");
    }
    const path = (file as { path?: unknown }).path;
    if (typeof path !== "string" || !path) throw new Error("npm pack returned an invalid package file path");
    const absolutePath = resolve(packageDirectory, path);
    const packageRelativePath = relative(packageDirectory, absolutePath);
    if (packageRelativePath === ".." || packageRelativePath.startsWith(`..${sep}`) || isAbsolute(packageRelativePath)) {
      throw new Error(`Package includes a file outside its directory: ${path}`);
    }
    const repositoryPath = relative(repositoryRoot, absolutePath).split(sep).join("/");
    if (!trackedPaths.has(repositoryPath)) {
      throw new Error(`Package includes an untracked or ignored pre-build file: ${path}`);
    }
  }
}

async function collectTrackedPaths(repositoryRoot: string, prefix = ""): Promise<Set<string>> {
  const result = await $`git ls-files --stage -z --cached`.cwd(repositoryRoot).quiet();
  const paths = new Set<string>();

  for (const record of result.stdout.toString().split("\0").filter(Boolean)) {
    const { mode, path, stage } = parseIndexRecord(record);
    if (stage !== "0") throw new Error(`Repository has an unresolved index entry: ${path}`);
    const prefixedPath = `${prefix}${path}`;
    paths.add(prefixedPath);
    if (mode !== GITLINK_MODE) continue;
    const nestedPaths = await collectTrackedPaths(resolve(repositoryRoot, path), `${prefixedPath}/`);
    for (const nestedPath of nestedPaths) paths.add(nestedPath);
  }
  return paths;
}

async function validateRepositoryCheckout(
  repositoryRoot: string,
  allowedChanges: ReadonlySet<string>,
  prefix: string,
): Promise<void> {
  const [indexResult, flagsResult] = await Promise.all([
    $`git ls-files --stage -z --cached`.cwd(repositoryRoot).quiet(),
    $`git ls-files -v -z --cached`.cwd(repositoryRoot).quiet(),
  ]);
  const flags = new Map<string, string>();

  for (const record of flagsResult.stdout.toString().split("\0").filter(Boolean)) {
    const flag = record.slice(0, 1);
    const path = record.slice(2);
    if (!flag || record.slice(1, 2) !== " " || !path) {
      throw new Error("Unable to parse Git index flags while validating package source");
    }
    flags.set(path, flag);
  }

  for (const record of indexResult.stdout.toString().split("\0").filter(Boolean)) {
    const { mode, objectId, path, stage } = parseIndexRecord(record);
    if (stage !== "0") throw new Error(`Repository has an unresolved index entry: ${path}`);
    if (flags.get(path) !== "H") throw new Error(`Repository index flags hide working tree changes: ${path}`);

    const absolutePath = resolve(repositoryRoot, path);
    const repositoryRelativePath = relative(repositoryRoot, absolutePath);
    if (
      repositoryRelativePath === ".." ||
      repositoryRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(repositoryRelativePath) ||
      repositoryRelativePath.split(sep).join("/") !== path
    ) {
      throw new Error(`Repository path escapes the repository: ${path}`);
    }

    const pathStat = await lstat(absolutePath).catch(() => null);
    if (!pathStat) throw new Error(`Repository path is missing: ${path}`);
    const prefixedPath = `${prefix}${path}`;
    if (allowedChanges.has(prefixedPath)) continue;

    if (mode === "100644" || mode === "100755") {
      if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
        throw new Error(`Repository path is not a regular file: ${path}`);
      }
      const hash = await readGitText(repositoryRoot, ["hash-object", `--path=${path}`, absolutePath]);
      const workingMode = pathStat.mode & 0o111 ? "100755" : "100644";
      if (hash !== objectId || workingMode !== mode) throw new Error(`Repository path differs from Git index: ${path}`);
      continue;
    }

    if (mode === "120000") {
      if (!pathStat.isSymbolicLink()) throw new Error(`Repository symlink is invalid: ${path}`);
      const expectedTarget = await $`git cat-file blob ${objectId}`.cwd(repositoryRoot).quiet();
      const actualTarget = await readlink(absolutePath, { encoding: "buffer" });
      if (!Buffer.from(expectedTarget.stdout).equals(actualTarget)) {
        throw new Error(`Repository symlink differs from Git index: ${path}`);
      }
      continue;
    }

    if (mode !== GITLINK_MODE) {
      throw new Error(`Repository has an unsupported Git mode: ${path}`);
    }
    if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
      throw new Error(`Repository gitlink is not initialized: ${path}`);
    }

    const [topLevel, superproject, head, gitDirectory, modulesPath] = await Promise.all([
      readGitText(absolutePath, ["rev-parse", "--show-toplevel"]),
      readGitText(absolutePath, ["rev-parse", "--show-superproject-working-tree"]),
      readGitText(absolutePath, ["rev-parse", "--verify", "HEAD"]),
      readGitText(absolutePath, ["rev-parse", "--absolute-git-dir"]),
      readGitText(repositoryRoot, ["rev-parse", "--git-path", "modules"]),
    ]);
    const moduleRelativePath =
      gitDirectory && modulesPath ? relative(resolve(repositoryRoot, modulesPath), resolve(gitDirectory)) : "";
    if (
      !topLevel ||
      !superproject ||
      resolve(topLevel) !== absolutePath ||
      resolve(superproject) !== repositoryRoot ||
      !moduleRelativePath ||
      moduleRelativePath === ".." ||
      moduleRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(moduleRelativePath)
    ) {
      throw new Error(`Repository gitlink is not initialized: ${path}`);
    }
    if (head !== objectId) throw new Error(`Repository gitlink does not match the recorded commit: ${path}`);

    const status = await $`git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none`
      .cwd(absolutePath)
      .quiet();
    if (status.stdout.length > 0) throw new Error(`Repository gitlink is dirty: ${path}`);
    await validateRepositoryCheckout(absolutePath, allowedChanges, `${prefixedPath}/`);
  }
}

function parseIndexRecord(record: string): { mode: string; objectId: string; path: string; stage: string } {
  const separatorIndex = record.indexOf("\t");
  const fields = separatorIndex < 0 ? [] : record.slice(0, separatorIndex).split(" ");
  const [mode, objectId, stage, ...unexpected] = fields;
  const path = separatorIndex < 0 ? "" : record.slice(separatorIndex + 1);
  if (!mode || !objectId || !stage || unexpected.length > 0 || !path) {
    throw new Error("Unable to parse Git index while validating package source");
  }
  if (!GIT_INDEX_MODE_PATTERN.test(mode) || !GIT_OBJECT_ID_PATTERN.test(objectId)) {
    throw new Error("Unable to parse Git index while validating package source");
  }
  return { mode, objectId, path, stage };
}

async function readGitText(cwd: string, args: string[]): Promise<string | null> {
  const result = await $`git ${args}`.cwd(cwd).quiet().nothrow();
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim() || null;
}

function readPackageIdentity(content: string, packageDir: string): { name: string; version: string } {
  const manifest = JSON.parse(content) as { name?: unknown; version?: unknown };
  if (
    typeof manifest.name !== "string" ||
    !manifest.name ||
    typeof manifest.version !== "string" ||
    !manifest.version
  ) {
    throw new Error(`Package manifest at ${packageDir} needs non-empty name and version fields`);
  }
  return { name: manifest.name, version: manifest.version };
}

export async function publishPackageArtifact(
  artifactPath: string,
  options: PublishArtifactOptions = {},
): Promise<void> {
  const resolvedArtifactPath = resolve(artifactPath);
  const cwd = resolve(options.cwd ?? ".");
  const manifestText = await readPackedManifest(resolvedArtifactPath);
  const access = resolveNpmAccess(manifestText);
  const { version } = readPackageIdentity(manifestText, resolvedArtifactPath);
  const manifest = JSON.parse(manifestText) as { publishConfig?: { tag?: unknown } };
  const inferredTag = manifest.publishConfig?.tag ? undefined : inferNpmPrereleaseTag(version);
  const tagArgs = inferredTag === undefined ? [] : ["--tag", inferredTag];
  const dryRunArgs = options.dryRun ? ["--dry-run", "--offline"] : [];
  await $`npm publish ${resolvedArtifactPath} --ignore-scripts --access ${access} ${tagArgs} ${dryRunArgs}`.cwd(cwd);
}
