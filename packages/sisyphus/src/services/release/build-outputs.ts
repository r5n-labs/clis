import { rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { Exit } from "@r5n/cli-core";
import { DEFAULT_BUILD_COMMAND } from "../../constants";
import type { ReleaseBuildConfig } from "../../types";
import { isEscapingPath } from "../ReleaseSource";
import { type BuildOutputMatcher, createBuildOutputMatcher, EMPTY_BUILD_OUTPUT_MATCHER } from "./build-output-matcher";
import { collectTrackedPaths, listIgnoredInputs, parseIndexRecords } from "./npm-pack";

export { type BuildOutputMatcher, createBuildOutputMatcher, EMPTY_BUILD_OUTPUT_MATCHER } from "./build-output-matcher";

const SUBMODULE_MODE = "160000";
const RELATIVE_PREFIX = "./";

export type ResolvedBuildConfig = {
  command: readonly string[];
  matcher: BuildOutputMatcher;
  outputs: readonly string[];
  root: readonly (readonly string[])[];
};

export function resolveBuildConfig(config: ReleaseBuildConfig | undefined): ResolvedBuildConfig {
  const command = config?.command ?? [...DEFAULT_BUILD_COMMAND];
  const root = config?.root ?? [];
  const outputs = config?.outputs ?? [];

  assertArgv(command, "release.build.command");
  for (const [index, argv] of root.entries()) {
    assertArgv(argv, `release.build.root[${index}]`);
    if (argv.length === 0) {
      throw new Exit(
        `Invalid release.build.root[${index}]`,
        'Each root build command must be a non-empty array of arguments, e.g. ["bun", "run", "build:dts"]',
      );
    }
  }

  for (const pattern of outputs) {
    if (!pattern || isAbsolute(pattern) || pattern.startsWith(RELATIVE_PREFIX) || isEscapingPath(pattern)) {
      throw new Exit(
        `Invalid release.build.outputs entry: ${pattern || "(empty)"}`,
        "Build output globs must be relative to the repository root, e.g. packages/*/dist/**",
      );
    }
  }

  if (outputs.length > 0 && command.length === 0 && root.length === 0) {
    throw new Exit(
      "release.build.outputs is declared but no build command runs",
      "Set release.build.command or release.build.root, or remove the declared outputs",
    );
  }

  return { command, matcher: createBuildOutputMatcher(outputs), outputs, root };
}

export async function assertBuildOutputsUntracked(repositoryRoot: string, matcher: BuildOutputMatcher): Promise<void> {
  if (matcher === EMPTY_BUILD_OUTPUT_MATCHER) return;

  const trackedPaths = await collectTrackedPaths(repositoryRoot);

  for (const path of trackedPaths) {
    if (!matcher.isOutput(path)) continue;
    throw new Exit(
      `Declared build output ${path} is tracked by Git`,
      "Add it to .gitignore, or narrow release.build.outputs so it excludes committed files",
    );
  }
}

export async function cleanBuildOutputs(root: string, prefix: string, matcher: BuildOutputMatcher): Promise<number> {
  if (matcher === EMPTY_BUILD_OUTPUT_MATCHER) return 0;

  let removed = 0;

  for (const path of await listIgnoredInputs(root, prefix)) {
    if (!matcher.isOutput(path)) continue;
    await rm(resolve(root, path.slice(prefix.length)), { force: true });
    removed += 1;
  }

  const index = await Bun.$`git ls-files --stage -z --cached`.cwd(root).quiet();
  for (const { mode, path } of parseIndexRecords(index.stdout.toString())) {
    if (mode !== SUBMODULE_MODE) continue;
    removed += await cleanBuildOutputs(resolve(root, path), `${prefix}${path}/`, matcher);
  }

  return removed;
}

export async function runBuildCommand(argv: readonly string[], cwd: string, context: string): Promise<void> {
  const subprocess = Bun.spawn([...argv], { cwd, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`${context}: ${stderr.trim() || `${argv[0]} exited with code ${exitCode}`}`);
  }
}

function assertArgv(argv: readonly string[], field: string): void {
  for (const argument of argv) {
    if (typeof argument === "string" && argument.length > 0) continue;
    throw new Exit(`Invalid ${field}`, "Every build command argument must be a non-empty string");
  }
}
