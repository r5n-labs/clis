import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { args, color, log } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { ATLAS_CONFIG_FILE, ATLAS_DIR, DEFAULT_ATLAS_CONFIG } from "../constants";
import { writePrivateFile } from "../services/file-output";
import { validateOptions } from "../utils";

const initArgs = args({
  force: { alias: "f", default: false, description: "Overwrite an existing config", type: "boolean" },
  global: { alias: "g", default: false, description: "Write ~/.atlas/config.json", type: "boolean" },
});

type InitCtx = Ctx<typeof initArgs>;

export class InitCommand extends BaseCommand {
  name = "init";
  description = "Create an Atlas config";
  args = initArgs;

  async execute(ctx: InitCtx): Promise<void> {
    validateOptions(ctx.args, initArgs, "Run 'atlas init --help' for supported options");
    const root = ctx.args.global ? homedir() : process.cwd();
    const configPath = join(root, ATLAS_DIR, ATLAS_CONFIG_FILE);

    await mkdir(join(root, ATLAS_DIR), { recursive: true });
    await writePrivateFile(
      configPath,
      `${JSON.stringify(DEFAULT_ATLAS_CONFIG, null, 2)}\n`,
      ctx.args.force,
      "Atlas config",
    );
    log.success(`Created ${color.green(configPath)}`);
  }
}
