import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { args, Exit, validateKnownArgs } from "@r5n/cli-core";
import type { Ctx } from "../base-command";
import { BaseCommand } from "../base-command";
import { ARGUS_DIR, JSON_INDENT } from "../constants";
import { defaultConfig } from "../presets";
import { shellArgument } from "../reports/llm-summary";
import { noPositionals, rejectExtraArguments, validateStringOptions } from "./options";

const initArgs = args({
  config: { type: "string", description: "Where to create config.json" },
  root: { type: "string", description: "Project to review (defaults to current directory)" },
  preset: { type: "string", default: "naming", description: "naming or all" },
});

export class InitCommand extends BaseCommand {
  name = "init";
  description = "Create an Argus project config";
  args = initArgs;
  positionals = noPositionals;

  async execute(ctx: Ctx<typeof initArgs, typeof noPositionals>): Promise<void> {
    validateKnownArgs(ctx.args, initArgs, "Run 'argus init --help'");
    rejectExtraArguments(ctx.positionals.extra);
    validateStringOptions(ctx.args, ["config", "root"]);
    const { preset } = ctx.args;
    if (preset !== "naming" && preset !== "all") throw new Exit("Preset must be naming or all");
    const path = resolve(ctx.args.config || join(ARGUS_DIR, "config.json"));
    const root = resolve(ctx.args.root || process.cwd());
    try {
      if (!statSync(root).isDirectory()) throw new Error("Not a directory");
    } catch {
      throw new Exit(`Project root must be an existing directory: ${root}`);
    }
    const config = defaultConfig(relative(dirname(path), root) || ".", preset);
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, `${JSON.stringify(config, null, JSON_INDENT)}\n`, { flag: "wx" });
    } catch {
      throw new Exit(`Cannot create ${path}`, "Choose a new config path; existing files are never overwritten");
    }
    console.log(`Created ${path}\nPreview requests:\nargus check --config ${shellArgument(path)}`);
  }
}
