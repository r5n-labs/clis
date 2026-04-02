import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Exit, color, log, multiselect, positionals, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { createProvider } from "../providers";
import { resolveProfile, resolveRunnerIds, selectProfile } from "../utils";

const removePositionals = positionals({
  profile: { description: "Profile name" },
  ids: { description: "Runner IDs (omit to target all)", variadic: true },
});

type RemoveCtx = Ctx<Record<string, never>, typeof removePositionals>;

export class RemoveCommand extends BaseCommand {
  name = "remove";
  description = "Deregister and remove runners";
  positionals = removePositionals;

  async execute(ctx: RemoveCtx) {
    const { name: profileName, profile } = ctx.interactive
      ? resolveProfile(ctx.config, await selectProfile(ctx.config))
      : resolveProfile(ctx.config, ctx.positionals.profile);

    const entries = ctx.config.get("runners") ?? [];
    const profileEntries = entries.filter((e) => e.profile === profileName);
    if (profileEntries.length === 0) {
      throw new Exit(`No runners found for profile "${profileName}"`, "Run hydra create to provision runners");
    }

    const ids = ctx.interactive
      ? await this.promptRunnerSelection(profileEntries.map((e) => e.id))
      : resolveRunnerIds(ctx.positionals.ids ?? [], profileEntries.map((e) => e.id));

    const provider = createProvider(profile);
    const s = spinner();

    for (const id of ids) {
      s.start(`Stopping and removing ${id}...`);
      await provider.stop([id]);
      await provider.remove([id]);
      await rm(join(profile.directory, id), { force: true, recursive: true });
      s.stop(`${color.red("-")} ${id}`);
    }

    const remaining = entries.filter((e) => !ids.includes(e.id));
    ctx.config.set("runners", remaining);

    log.info(`${color.green("Removed")} ${ids.length} runner(s).`);
  }

  private async promptRunnerSelection(ids: string[]): Promise<string[]> {
    return multiselect({
      message: "Select runners to remove",
      options: ids.map((id) => ({ label: id, value: id })),
      required: true,
    });
  }
}
