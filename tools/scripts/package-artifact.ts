import { rename } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { $ } from "bun";

type PublishArtifactOptions = { cwd?: string; dryRun?: boolean; tag?: string };

export async function preparePackageArtifact(packageDir: string, artifactPath: string): Promise<void> {
  const pkgDir = resolve(packageDir);
  const pkgJsonPath = resolve(pkgDir, "package.json");
  const resolvedArtifactPath = resolve(artifactPath);
  const originalManifest = await Bun.file(pkgJsonPath).text();
  const originalIdentity = readPackageIdentity(originalManifest, packageDir);
  let preparationError: unknown;

  try {
    await $`bun run package:prepare`.cwd(pkgDir);
    const preparedManifest = await Bun.file(pkgJsonPath).text();
    const preparedIdentity = readPackageIdentity(preparedManifest, packageDir);
    if (preparedIdentity.name !== originalIdentity.name || preparedIdentity.version !== originalIdentity.version) {
      throw new Error(
        `Prepared package identity changed from ${originalIdentity.name}@${originalIdentity.version} to ${preparedIdentity.name}@${preparedIdentity.version}`,
      );
    }
    const artifactDirectory = dirname(resolvedArtifactPath);
    const result = await $`npm pack --ignore-scripts --json --pack-destination ${artifactDirectory}`
      .cwd(pkgDir)
      .quiet();
    const output = JSON.parse(result.stdout.toString()) as Array<{ filename?: unknown }>;
    const filename = output[0]?.filename;
    if (typeof filename !== "string" || !filename) throw new Error("npm pack did not return an artifact filename");
    const generatedPath = resolve(artifactDirectory, filename);
    const artifactRelativePath = relative(artifactDirectory, generatedPath);
    if (
      artifactRelativePath === ".." ||
      artifactRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(artifactRelativePath)
    ) {
      throw new Error("npm pack returned an artifact outside the destination directory");
    }
    if (generatedPath !== resolvedArtifactPath) await rename(generatedPath, resolvedArtifactPath);
  } catch (error) {
    preparationError = error;
  }

  let restorationError: unknown;
  try {
    await Bun.write(pkgJsonPath, originalManifest);
  } catch (error) {
    restorationError = error;
  }

  if (preparationError) {
    if (restorationError) {
      throw new AggregateError([preparationError, restorationError], `Failed to prepare and restore ${packageDir}`);
    }
    throw preparationError;
  }

  if (restorationError) throw restorationError;
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
  const dryRunArgs = options.dryRun ? ["--dry-run", "--force"] : [];
  const tagArgs = options.tag ? ["--tag", options.tag] : [];
  await $`npm publish ${resolvedArtifactPath} --ignore-scripts --access public ${tagArgs} ${dryRunArgs}`.cwd(cwd);
}
