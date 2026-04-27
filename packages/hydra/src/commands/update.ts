import { color, Exit, log, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { createProvider } from "../providers";
import type { Profile } from "../types";

type UpdateCtx = Ctx;

export class UpdateCommand extends BaseCommand {
  name = "update";
  description = "Update runners to the latest version";

  async execute(ctx: UpdateCtx) {
    const profiles = ctx.config.get("profiles");
    const entries = ctx.config.get("runners") ?? [];

    if (entries.length === 0) {
      throw new Exit("No runners found", "Run hydra create to provision runners");
    }

    const s = spinner();
    const byProfile = Map.groupBy(entries, (e) => e.profile);
    let currentVersion: string | null = null;
    let latestVersion = "";
    let versionChecked = false;

    for (const [profileName, profileEntries] of byProfile) {
      const profile = profiles[profileName] as Profile | undefined;
      const firstRunner = profileEntries[0];
      if (!profile || !firstRunner) continue;

      const provider = createProvider(profile);

      if (!versionChecked) {
        versionChecked = true;
        s.start("Checking for updates...");
        const result = await provider.download();
        latestVersion = result.version;
        currentVersion = await provider.currentVersion(firstRunner.id);
        s.stop(`Current: v${currentVersion ?? "unknown"} | Latest: v${latestVersion}`);

        if (currentVersion === latestVersion) {
          log.info(`Already on latest version ${color.dim(`(v${latestVersion})`)}`);
          return;
        }
      }

      const statuses = await provider.list();
      const runningIds = new Set(statuses.filter((r) => r.status === "running").map((r) => r.id));

      for (const entry of profileEntries) {
        const wasRunning = runningIds.has(entry.id);

        s.start(`Updating ${entry.id}...`);

        if (wasRunning) await provider.stop([entry.id]);
        await provider.update([entry.id]);
        if (wasRunning) await provider.start([entry.id]);

        const suffix = wasRunning ? ` ${color.dim("(restarted)")}` : "";
        s.stop(`${color.green("✓")} ${entry.id}${suffix}`);
      }
    }

    log.info(`${color.green("Updated")} ${entries.length} runner(s) from v${currentVersion} to v${latestVersion}`);
  }
}
