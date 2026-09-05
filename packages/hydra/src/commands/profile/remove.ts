import { rm } from "node:fs/promises";
import { join } from "node:path";
import { args, color, confirm, Exit, log, positionals, spinner, validateKnownArgs } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { createProvider } from "../../providers";
import type { Profile } from "../../types";
import { resolveProfile, selectProfile } from "../../utils";

const removePositionals = positionals({ name: { description: "Profile name to remove" } });
const removeArgs = args({
  yes: { alias: "y", default: false, description: "Skip runner removal confirmation", type: "boolean" },
});

type RemoveCtx = Ctx<typeof removeArgs, typeof removePositionals>;

export class ProfileRemoveCommand extends BaseCommand {
  name = "remove";
  description = "Delete a profile and its runners";
  positionals = removePositionals;
  args = removeArgs;

  async execute(ctx: RemoveCtx) {
    validateKnownArgs(ctx.args, this.args, "Run 'hydra profile remove --help' for supported options");
    const profileName = ctx.interactive ? await selectProfile(ctx.config) : ctx.positionals.name;

    if (!profileName) {
      throw new Exit("Profile name is required", "Usage: hydra profile remove <name>");
    }

    const { profile } = resolveProfile(ctx.config, profileName);

    const entries = ctx.config.get("runners") ?? [];
    const profileRunners = entries.filter((e) => e.profile === profileName);

    if (profileRunners.length > 0) {
      if (!ctx.args.yes) {
        if (!process.stdout.isTTY)
          throw new Exit(
            "Runner removal requires confirmation",
            "Pass --yes to remove the profile and its runners without a prompt",
          );
        const proceed = await confirm({
          initialValue: true,
          message: `This will stop and remove ${profileRunners.length} runner(s). Continue?`,
        });
        if (!proceed) return;
      }

      await this.removeRunners(
        ctx,
        profile,
        profileRunners.map((e) => e.id),
      );
      const remainingEntries = entries.filter((e) => e.profile !== profileName);
      ctx.config.set("runners", remainingEntries);
    }

    const { [profileName]: _, ...remaining } = ctx.config.get("profiles");
    ctx.config.set("profiles", remaining);

    const defaultProfile = ctx.config.get("defaultProfile");
    if (defaultProfile === profileName) {
      const remainingNames = Object.keys(remaining);
      ctx.config.set("defaultProfile", remainingNames[0]);
    }

    log.info(`${color.green("Removed")} profile "${profileName}".`);
  }

  private async removeRunners(ctx: RemoveCtx, profile: Profile, ids: string[]) {
    const provider = createProvider(profile);
    const s = spinner();

    for (const id of ids) {
      s.start(`Stopping and removing ${id}...`);
      await provider.stop([id]);
      await provider.remove([id]);
      await rm(join(profile.directory, id), { force: true, recursive: true });
      ctx.config.set(
        "runners",
        (ctx.config.get("runners") ?? []).filter((entry) => entry.id !== id),
      );
      s.stop(`${color.red("-")} ${id}`);
    }
  }
}
