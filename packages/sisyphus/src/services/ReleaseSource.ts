import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { StoneJson } from "../domain";
import type { PackageRelease } from "../types";

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

  const result = await Bun.$`git ls-files -z --cached --others --exclude-standard`.cwd(repositoryRoot).quiet();
  const files = result.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .filter((path) => path !== metadataRelativePath && !path.startsWith(`${metadataRelativePath}/`))
    .sort();
  const sourceHash = createHash("sha256");

  for (const path of files) {
    const absolutePath = resolve(repositoryRoot, path);
    const repositoryRelativePath = relative(repositoryRoot, absolutePath);
    if (isOutsideRepository(repositoryRelativePath)) {
      throw new Exit(`Release source path escapes the repository: ${path}`);
    }

    const pathStatus = await lstat(absolutePath).catch(() => null);
    sourceHash.update(path);
    sourceHash.update("\0");
    if (!pathStatus) {
      sourceHash.update("deleted");
    } else {
      if (!pathStatus.isFile() || pathStatus.isSymbolicLink()) {
        throw new Exit(`Release source path is not a regular file: ${path}`);
      }
      sourceHash.update(
        createHash("sha256")
          .update(await readFile(absolutePath))
          .digest(),
      );
      sourceHash.update(pathStatus.mode & 0o111 ? "100755" : "100644");
    }
    sourceHash.update("\0");
  }

  return sourceHash.digest("hex");
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
