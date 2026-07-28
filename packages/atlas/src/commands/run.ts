import { resolve } from "node:path";
import { type ArgDefinition, args, Exit, positionals } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { loadAtlasConfig, resolveAtlasEnv } from "../services/config";
import { splitCsv } from "../utils";

const runArgs = args({
  cwd: { description: "Working directory override", type: "string" },
  profile: { alias: "p", description: "Comma-separated profiles to apply", type: "string" },
});

const GLOBAL_ARG_KEYS = ["help", "h", "interactive", "i", "version", "v"];

const RUN_ARG_KEYS: ReadonlySet<string> = new Set([
  ...GLOBAL_ARG_KEYS,
  ...Object.entries<ArgDefinition>(runArgs).flatMap(([key, def]) => (def.alias ? [key, def.alias] : [key])),
]);

const runPositionals = positionals({ command: { description: "Command to run", required: true, variadic: true } });

type RunCtx = Ctx<typeof runArgs, typeof runPositionals>;

type BuildRunEnvironmentOptions = { cwd?: string; env?: Record<string, string | undefined>; profiles?: string[] };

export class RunCommand extends BaseCommand {
  name = "run";
  description = "Run a command with resolved Atlas env";
  args = runArgs;
  positionals = runPositionals;

  async execute(ctx: RunCtx): Promise<void> {
    const unknownFlag = Object.keys(ctx.args).find((flag) => !RUN_ARG_KEYS.has(flag));
    if (unknownFlag !== undefined) {
      throw new Exit(
        `Unknown option: --${unknownFlag}`,
        "Put child command flags after --: atlas run -p app -- <cmd> --flags",
      );
    }

    const command = ctx.positionals.command;
    if (command.length === 0) {
      throw new Exit("Command is required", "Usage: atlas run --profile app:web -- <command...>");
    }

    if (ctx.args.cwd !== undefined && ctx.args.cwd.trim().length === 0) {
      throw new Exit("--cwd must not be empty", "Usage: atlas run --cwd <dir> -- <command...>");
    }

    const profiles = ctx.args.profile === undefined ? undefined : splitCsv(ctx.args.profile);
    if (profiles?.length === 0) {
      throw new Exit(
        "--profile must include at least one profile",
        "Usage: atlas run --profile <name,...> -- <command...>",
      );
    }

    const cwd = resolve(ctx.args.cwd ?? process.cwd());
    const env = buildRunEnvironment({ cwd, env: process.env, profiles });

    const proc = Bun.spawn(command, { cwd, env, stderr: "inherit", stdin: "inherit", stdout: "inherit" });
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

export function buildRunEnvironment(options: BuildRunEnvironmentOptions = {}): Record<string, string> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = loadAtlasConfig({ cwd });
  const resolved = resolveAtlasEnv(loaded, { env: options.env, profiles: options.profiles });
  const baseEnv = Object.fromEntries(
    Object.entries(options.env ?? process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  return { ...baseEnv, ...resolved.env };
}
