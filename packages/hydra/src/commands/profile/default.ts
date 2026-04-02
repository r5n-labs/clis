import { Exit, color, log, positionals } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { resolveProfile, selectProfile } from "../../utils";

const defaultPositionals = positionals({
  name: { description: "Profile name to set as default" },
});

type DefaultCtx = Ctx<Record<string, never>, typeof defaultPositionals>;

export class ProfileDefaultCommand extends BaseCommand {
  name = "default";
  description = "Set the default profile";
  positionals = defaultPositionals;

  async execute(ctx: DefaultCtx) {
    const profileName = ctx.interactive
      ? await selectProfile(ctx.config)
      : ctx.positionals.name;

    if (!profileName) {
      throw new Exit("Profile name is required", "Usage: hydra profile default <name>");
    }

    const { name } = resolveProfile(ctx.config, profileName);

    const current = ctx.config.get("defaultProfile");
    if (current === name) {
      log.info(`"${name}" is already the default profile.`);
      return;
    }

    ctx.config.set("defaultProfile", name);
    log.info(`${color.green("Default profile set to")} "${name}".`);
  }
}
