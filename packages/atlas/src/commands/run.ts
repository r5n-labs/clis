import { statSync } from "node:fs";
import { resolve } from "node:path";
import { args, Exit, positionals } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { loadAtlasConfig, resolveAtlasEnv } from "../services/config";
import { hasErrorCode, parseProfileOption, validateOptions, validatePathOption } from "../utils";

const runArgs = args({
  cwd: { description: "Working directory override", type: "string" },
  profile: { alias: "p", description: "Comma-separated profiles to apply", type: "string" },
});

const COMMAND_NOT_FOUND_EXIT_CODE = 127;
const COMMAND_NOT_EXECUTABLE_EXIT_CODE = 126;
const PASSTHROUGH_HINT = "Put child command flags after --: atlas run -p app -- <cmd> --flags";
const PROFILE_USAGE = "Usage: atlas run --profile <name,...> -- <command...>";

const runPositionals = positionals({ command: { description: "Command to run", required: true, variadic: true } });

type RunCtx = Ctx<typeof runArgs, typeof runPositionals>;

type BuildRunEnvironmentOptions = { cwd?: string; env?: Record<string, string | undefined>; profiles?: string[] };

export class RunCommand extends BaseCommand {
  name = "run";
  description = "Run a command with resolved Atlas env";
  args = runArgs;
  positionals = runPositionals;

  async execute(ctx: RunCtx): Promise<void> {
    validateOptions(ctx.args, runArgs, PASSTHROUGH_HINT);

    const command = ctx.positionals.command;
    if (command.length === 0) {
      throw new Exit("Command is required", "Usage: atlas run --profile app:web -- <command...>");
    }

    validatePathOption(ctx.args.cwd, "cwd", "Usage: atlas run --cwd <dir> -- <command...>");

    const profiles = parseProfileOption(ctx.args.profile, PROFILE_USAGE);
    const cwd = resolve(ctx.args.cwd ?? process.cwd());
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Exit(`Working directory is not a directory: ${cwd}`, "Usage: atlas run --cwd <dir> -- <command...>");
    }
    const env = buildRunEnvironment({ cwd, env: process.env, profiles });

    const proc = spawnCommand(command, cwd, env);
    const forwardSigint = (): void => proc.kill("SIGINT");
    const forwardSigterm = (): void => proc.kill("SIGTERM");
    process.on("SIGINT", forwardSigint);
    process.on("SIGTERM", forwardSigterm);

    let exitCode: number;
    try {
      exitCode = await proc.exited;
    } finally {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
    }

    if (exitCode !== 0) process.exit(exitCode);
  }
}

function spawnCommand(command: string[], cwd: string, env: Record<string, string>) {
  try {
    return Bun.spawn(command, { cwd, env, stderr: "inherit", stdin: "inherit", stdout: "inherit" });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new Exit(
        `Command not found: ${command[0]}`,
        "Check that it is installed and on PATH",
        COMMAND_NOT_FOUND_EXIT_CODE,
      );
    }
    if (hasErrorCode(error, "EACCES")) {
      throw new Exit(
        `Command is not executable: ${command[0]}`,
        "Check the executable permissions",
        COMMAND_NOT_EXECUTABLE_EXIT_CODE,
      );
    }
    throw error;
  }
}

export function buildRunEnvironment(options: BuildRunEnvironmentOptions = {}): Record<string, string> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = loadAtlasConfig({ cwd });
  const resolved = resolveAtlasEnv(loaded, { env: options.env, profiles: options.profiles });
  const baseEnv = Object.fromEntries(
    Object.entries(options.env ?? process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  return { ...baseEnv, ...resolved.env };
}
