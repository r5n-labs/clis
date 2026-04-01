import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Exit, color, confirm, log, positionals, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { createProvider } from "../../providers";
import { selectProfile } from "../../utils";

const removePositionals = positionals({
  name: { description: "Profile name to remove" },
});

type RemoveCtx = Ctx<Record<string, never>, typeof removePositionals>;

export class ProfileRemoveCommand extends BaseCommand {
  name = "remove";
  description = "Remove a profile";
  positionals = removePositionals;

  async execute(ctx: RemoveCtx) {
    const profileName = ctx.interactive
      ? await selectProfile(ctx.config)
      : ctx.positionals.name;

    if (!profileName) {
      throw new Exit("Profile name is required", "Usage: hydra profile remove <name>");
    }

    const profiles = ctx.config.get("profiles");
    if (!profiles[profileName]) {
      throw new Exit(`Profile "${profileName}" not found`);
    }

    const entries = ctx.config.get("runners") ?? [];
    const profileRunners = entries.filter((e) => e.profile === profileName);

    if (profileRunners.length > 0) {
      const proceed = await confirm({
        initialValue: true,
        message: `This will stop and remove ${profileRunners.length} runner(s). Continue?`,
      });
      if (!proceed) return;

      await this.removeRunners(ctx, profileName, profileRunners.map((e) => e.id));
    }

    const { [profileName]: _, ...remaining } = profiles;
    ctx.config.set("profiles", remaining);

    const defaultProfile = ctx.config.get("defaultProfile");
    if (defaultProfile === profileName) {
      const remainingNames = Object.keys(remaining);
      ctx.config.set("defaultProfile", remainingNames[0]);
    }

    log.info(`${color.green("Removed")} profile "${profileName}".`);
  }

  private async removeRunners(ctx: RemoveCtx, profileName: string, ids: string[]) {
    const profile = ctx.config.get("profiles")[profileName];
    if (!profile) return;

    const provider = createProvider(profile);
    const s = spinner();

    for (const id of ids) {
      s.start(`Stopping and removing ${id}...`);
      await provider.stop([id]);
      await provider.remove([id]);
      await rm(join(profile.directory, id), { force: true, recursive: true });
      s.stop(`${color.red("-")} ${id}`);
    }

    const entries = ctx.config.get("runners") ?? [];
    const remaining = entries.filter((e) => e.profile !== profileName);
    ctx.config.set("runners", remaining);
  }
}
