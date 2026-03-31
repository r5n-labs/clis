import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Exit, args, color, log, positionals, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { DEFAULT_PROFILE } from "../constants";
import { createProvider } from "../providers";
import { resolveRunnerIds } from "../utils";

const removePositionals = positionals({
  ids: { description: "Runner IDs to remove, or 'all'", variadic: true },
});

const removeArgs = args({
  profile: { alias: "p", description: "Profile name to use", type: "string" },
});

type RemoveCtx = Ctx<typeof removeArgs, typeof removePositionals>;

export class RemoveCommand extends BaseCommand {
  name = "remove";
  description = "Deregister and remove runners";
  positionals = removePositionals;
  args = removeArgs;

  async execute(ctx: RemoveCtx) {
    const profileName = ctx.args.profile ?? ctx.config.get("defaultProfile") ?? DEFAULT_PROFILE;
    const profile = ctx.config.get("profiles")[profileName];
    if (!profile) {
      throw new Exit(`Profile "${profileName}" not found`);
    }

    const entries = ctx.config.get("runners") ?? [];
    const profileEntries = entries.filter((e) => e.profile === profileName);
    if (profileEntries.length === 0) {
      throw new Exit(`No runners found for profile "${profileName}"`, "Use --profile to specify a different profile");
    }

    const ids = resolveRunnerIds(ctx.positionals.ids, profileEntries.map((e) => e.id));
    const provider = createProvider(profile);
    const s = spinner();

    for (const id of ids) {
      s.start(`Removing ${id}...`);
      await provider.remove([id]);
      await rm(join(profile.directory, id), { force: true, recursive: true });
      s.stop(`${color.red("-")} ${id}`);
    }

    const remaining = entries.filter((e) => !ids.includes(e.id));
    ctx.config.set("runners", remaining);

    log.info(`${color.green("Removed")} ${ids.length} runner(s).`);
  }

}
