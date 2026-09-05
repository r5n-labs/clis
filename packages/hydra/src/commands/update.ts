import { color, Exit, log, spinner, validateKnownArgs } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { createProvider } from "../providers";
import type { Profile } from "../types";
import { maybeAutoCleanup } from "./cleanup";

type UpdateCtx = Ctx;

export class UpdateCommand extends BaseCommand {
  name = "update";
  description = "Update runner binaries";

  async execute(ctx: UpdateCtx) {
    validateKnownArgs(ctx.args, this.args, "Run 'hydra update --help' for supported options");
    const profiles = ctx.config.get("profiles");
    const entries = ctx.config.get("runners") ?? [];

    if (entries.length === 0) {
      throw new Exit("No runners found", "Run hydra create to provision runners");
    }

    const s = spinner();
    const byProfile = Map.groupBy(entries, (e) => e.profile);
    let updated = 0;

    for (const [profileName, profileEntries] of byProfile) {
      const profile = profiles[profileName] as Profile | undefined;
      if (!profile) continue;

      const provider = createProvider(profile);

      s.start(`Checking for updates for "${profileName}"...`);
      const { version: latestVersion } = await provider.download();
      s.stop(`Latest: v${latestVersion}`);

      const statuses = await provider.list();
      const runningIds = new Set(statuses.filter((r) => r.status === "running").map((r) => r.id));

      for (const entry of profileEntries) {
        if ((await provider.currentVersion(entry.id)) === latestVersion) continue;
        const wasRunning = runningIds.has(entry.id);

        s.start(`Updating ${entry.id}...`);

        if (wasRunning) await provider.stop([entry.id]);
        await provider.update([entry.id]);
        if (wasRunning) await provider.start([entry.id]);
        updated++;

        const suffix = wasRunning ? ` ${color.dim("(restarted)")}` : "";
        s.stop(`${color.green("✓")} ${entry.id}${suffix}`);
      }
    }

    log.info(
      updated > 0
        ? `${color.green("Updated")} ${updated} runner(s).`
        : "All runners are already on the latest version.",
    );

    await maybeAutoCleanup(ctx);
  }
}
