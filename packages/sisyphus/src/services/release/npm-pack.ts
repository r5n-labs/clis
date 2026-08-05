import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { Package } from "../../domain";
import { canonicalizeJson, isEscapingPath } from "../ReleaseSource";
import { type BuildOutputMatcher, EMPTY_BUILD_OUTPUT_MATCHER } from "./build-output-matcher";

export type PackedPackageIdentity = { name: string; version: string };

const TAR_BLOCK_SIZE = 512;
const TAR_NAME_LENGTH = 100;
const TAR_SIZE_OFFSET = 124;
const TAR_SIZE_LENGTH = 12;
const TAR_PREFIX_OFFSET = 345;
const TAR_PREFIX_LENGTH = 155;
const PACKED_MANIFEST_PATH = "package/package.json";
const MAX_REPORTED_IGNORED_INPUTS = 20;

export async function packNpmArtifact(packageDirectory: string, artifactPath: string): Promise<PackedPackageIdentity> {
  const artifactDirectory = dirname(artifactPath);
  const result = await Bun.$`npm pack --ignore-scripts --json --pack-destination ${artifactDirectory}`
    .cwd(packageDirectory)
    .quiet();
  const output = JSON.parse(result.stdout.toString()) as Array<{
    filename?: unknown;
    name?: unknown;
    version?: unknown;
  }>;
  const packed = output[0];
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
  if (isEscapingPath(relative(artifactDirectory, generatedPath))) {
    throw new Error("npm pack returned an artifact outside the destination directory");
  }
  if (generatedPath !== resolve(artifactPath)) await rename(generatedPath, artifactPath);
  return { name: packed.name, version: packed.version };
}

export async function listPackFilePaths(pkg: Package, packageDirectory: string): Promise<string[]> {
  const result = await Bun.$`npm pack --dry-run --ignore-scripts --json`.cwd(packageDirectory).quiet();
  const output = JSON.parse(result.stdout.toString()) as Array<{ files?: unknown }>;
  const files = output[0]?.files;
  if (!Array.isArray(files)) throw new Error(`npm pack did not return a file list for ${pkg.name}`);

  return files.map((file) => {
    if (typeof file !== "object" || file === null || Array.isArray(file) || !("path" in file)) {
      throw new Error(`npm pack returned an invalid file entry for ${pkg.name}`);
    }
    const path = (file as { path?: unknown }).path;
    if (typeof path !== "string" || !path) {
      throw new Error(`npm pack returned an invalid file path for ${pkg.name}`);
    }
    if (isEscapingPath(relative(packageDirectory, resolve(packageDirectory, path)))) {
      throw new Exit(`Package ${pkg.name} includes a file outside its directory: ${path}`);
    }
    return path;
  });
}

export async function stagePackageForPack(
  pkg: Package,
  packageDirectory: string,
  publishManifest: string,
): Promise<string> {
  const paths = await listPackFilePaths(pkg, packageDirectory);
  const stagingDirectory = await mkdtemp(join(tmpdir(), "sisyphus-package-stage-"));

  try {
    for (const path of paths) {
      const destination = resolve(stagingDirectory, path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(resolve(packageDirectory, path), destination, {
        errorOnExist: true,
        force: false,
        recursive: false,
        verbatimSymlinks: true,
      });
    }
    await writeFile(join(stagingDirectory, "package.json"), publishManifest, "utf-8");
    return stagingDirectory;
  } catch (error) {
    try {
      await rm(stagingDirectory, { force: true, recursive: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to clean staged npm package");
    }
    throw error;
  }
}

export async function validateExistingPackInputs(
  pkg: Package,
  packageDirectory: string,
  repositoryRoot: string,
  matcher: BuildOutputMatcher = EMPTY_BUILD_OUTPUT_MATCHER,
): Promise<void> {
  const [paths, trackedPaths] = await Promise.all([
    listPackFilePaths(pkg, packageDirectory),
    collectTrackedPaths(repositoryRoot),
  ]);

  for (const path of paths) {
    const repositoryPath = relative(repositoryRoot, resolve(packageDirectory, path)).split(sep).join("/");
    if (!trackedPaths.has(repositoryPath) && !matcher.isOutput(repositoryPath)) {
      throw new Exit(`Package ${pkg.name} includes an untracked or ignored pre-build file: ${path}`);
    }
  }
}

export async function listIgnoredInputs(root: string, prefix: string): Promise<string[]> {
  const result = await Bun.$`git ls-files --others --ignored --exclude-standard -z`.cwd(root).quiet();

  return result.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.split("/").includes("node_modules"))
    .map((path) => `${prefix}${path}`);
}

export async function validateRepositoryIgnoredInputs(
  root: string,
  prefix: string,
  matcher: BuildOutputMatcher = EMPTY_BUILD_OUTPUT_MATCHER,
): Promise<void> {
  const [ignoredPaths, indexResult] = await Promise.all([
    listIgnoredInputs(root, prefix),
    Bun.$`git ls-files --stage -z --cached`.cwd(root).quiet(),
  ]);
  const ignoredInputs = ignoredPaths.filter((path) => !matcher.isOutput(path));
  if (ignoredInputs.length > 0) {
    const shown = ignoredInputs.slice(0, MAX_REPORTED_IGNORED_INPUTS);
    const hidden = ignoredInputs.length - shown.length;
    throw new Exit(
      `Repository contains ${ignoredInputs.length} ignored build input(s) outside node_modules`,
      `Remove ignored source and stale build outputs before preparing npm artifacts (preview with git clean -ndX):\n${shown.join("\n")}${hidden > 0 ? `\n...and ${hidden} more` : ""}`,
    );
  }

  for (const { mode, path } of parseIndexRecords(indexResult.stdout.toString())) {
    if (mode === "160000") await validateRepositoryIgnoredInputs(resolve(root, path), `${prefix}${path}/`, matcher);
  }
}

export function parseIndexRecords(stdout: string): Array<{ mode: string; stage: string; path: string }> {
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separatorIndex = record.indexOf("\t");
      const fields = separatorIndex < 0 ? [] : record.slice(0, separatorIndex).split(" ");
      const [mode, , stage, ...unexpected] = fields;
      const path = separatorIndex < 0 ? "" : record.slice(separatorIndex + 1);
      if (!mode || !stage || unexpected.length > 0 || !path) {
        throw new Error("Unable to parse Git index while collecting tracked package inputs");
      }
      return { mode, path, stage };
    });
}

export async function collectTrackedPaths(repositoryRoot: string, prefix = ""): Promise<Set<string>> {
  const result = await Bun.$`git ls-files --stage -z --cached`.cwd(repositoryRoot).quiet();
  const paths = new Set<string>();

  for (const { mode, stage, path } of parseIndexRecords(result.stdout.toString())) {
    if (stage !== "0") throw new Exit(`Repository has an unresolved index entry: ${path}`);
    const prefixedPath = `${prefix}${path}`;
    paths.add(prefixedPath);
    if (mode !== "160000") continue;
    const nestedPaths = await collectTrackedPaths(resolve(repositoryRoot, path), `${prefixedPath}/`);
    for (const nestedPath of nestedPaths) paths.add(nestedPath);
  }
  return paths;
}

export async function readPackedManifest(artifactPath: string): Promise<string> {
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

export function readTarString(archive: Uint8Array, offset: number, length: number, decoder: TextDecoder): string {
  const field = archive.subarray(offset, offset + length);
  const terminator = field.indexOf(0);
  return decoder.decode(terminator < 0 ? field : field.subarray(0, terminator));
}

export function sameJsonDocument(first: string, second: string): boolean {
  return JSON.stringify(canonicalizeJson(JSON.parse(first))) === JSON.stringify(canonicalizeJson(JSON.parse(second)));
}
