import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { args, color, Exit, log } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { ATLAS_CONFIG_FILE, ATLAS_DIR, DEFAULT_ATLAS_CONFIG } from "../constants";

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
    const root = ctx.args.global ? homedir() : process.cwd();
    const configPath = join(root, ATLAS_DIR, ATLAS_CONFIG_FILE);

    if (existsSync(configPath) && !ctx.args.force) {
      throw new Exit(`Atlas config already exists: ${configPath}`, "Use --force to overwrite it");
    }

    await mkdir(join(root, ATLAS_DIR), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(DEFAULT_ATLAS_CONFIG, null, 2)}\n`, "utf8");
    log.success(`Created ${color.green(configPath)}`);
  }
}
