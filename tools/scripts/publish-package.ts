import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePackageArtifact, publishPackageArtifact } from "./package-artifact";

const ARTIFACT_FILENAME = "package.tgz";
const DRY_RUN_FLAG = "--dry-run";
const FAILURE_EXIT_CODE = 1;
const USAGE = `Usage: bun ./publish-package.ts ./packages/hydra [${DRY_RUN_FLAG}]`;

type PublishArguments = { dryRun: boolean; packageDir: string };

function failArgumentParsing(message: string): never {
  throw new Error(`${message}. ${USAGE}`);
}

function parseArguments(argv: readonly string[]): PublishArguments {
  let dryRun = false;
  let packageDir: string | undefined;

  for (const arg of argv) {
    if (arg === DRY_RUN_FLAG) {
      if (dryRun) failArgumentParsing(`Duplicate flag: ${DRY_RUN_FLAG}`);
      dryRun = true;
      continue;
    }

    if (arg.startsWith("-")) failArgumentParsing(`Unknown flag: ${arg}`);
    if (packageDir !== undefined) failArgumentParsing(`Unexpected extra package: ${arg}`);
    packageDir = arg;
  }

  if (packageDir === undefined) failArgumentParsing("No package provided");
  return { dryRun, packageDir };
}

function getExitCode(error: unknown): number {
  return typeof error === "object" && error !== null && "exitCode" in error && typeof error.exitCode === "number"
    ? error.exitCode || FAILURE_EXIT_CODE
    : FAILURE_EXIT_CODE;
}

function reportFailure(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof AggregateError) for (const inner of error.errors) reportFailure(inner);
}

async function main(argv: readonly string[]): Promise<number> {
  let args: PublishArguments;
  try {
    args = parseArguments(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return FAILURE_EXIT_CODE;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "r5n-package-"));
  const artifactPath = join(tempDir, ARTIFACT_FILENAME);

  try {
    await preparePackageArtifact(args.packageDir, artifactPath);
    await publishPackageArtifact(artifactPath, { cwd: args.packageDir, dryRun: args.dryRun });
    return 0;
  } catch (error) {
    reportFailure(error);
    console.error(`\nPublish failed for ${args.packageDir}${args.dryRun ? " (dry run)" : ""}`);
    return getExitCode(error);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
