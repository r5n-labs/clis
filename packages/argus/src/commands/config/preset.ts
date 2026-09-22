import { positionals } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { PRESETS } from "../../presets";
import { configActions, configArgs } from "./shared";

const presetPositionals = positionals({
  names: { variadic: true, description: `${Object.keys(PRESETS).join(", ")} or all` },
});

export class PresetCommand extends BaseCommand {
  name = "preset";
  description = "Add built-in review presets";

  init(): void {
    this.registerSubcommands([new PresetAddCommand(), new PresetUpgradeCommand()]);
  }
}

class PresetUpgradeCommand extends BaseCommand {
  name = "upgrade";
  description = "Replace unmodified broad comment/test presets with independent checks";
  args = configArgs;

  async execute(ctx: Ctx<typeof configArgs>): Promise<void> {
    configActions(ctx.args, this.args).upgradePresets();
  }
}

class PresetAddCommand extends BaseCommand {
  name = "add";
  description = "Add presets without overwriting customised questions";
  args = configArgs;
  positionals = presetPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof configArgs, typeof presetPositionals>): Promise<void> {
    await configActions(ctx.args, this.args).addPresets(ctx.positionals.names);
  }
}
