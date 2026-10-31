import { color, Exit, log, spinner, validateKnownArgs } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { createProvider, resolveJobHooks } from "../providers";
import { maybeAutoCleanup } from "./cleanup";

type UpdateCtx = Ctx;

export class UpdateCommand extends BaseCommand {
  name = "update";
  description = "Update runner binaries and job hooks";

  async execute(ctx: UpdateCtx) {
    validateKnownArgs(ctx.args, this.args, "Run 'hydra update --help' for supported options");
    const profiles = ctx.config.get("profiles");
    const entries = ctx.config.get("runners") ?? [];

    if (entries.length === 0) {
      throw new Exit("No runners found", "Run hydra create to provision runners");
    }

    const s = spinner();
    const byProfile = Map.groupBy(entries, (e) => e.profile);
    for (const profileName of byProfile.keys()) {
      const profile = Object.hasOwn(profiles, profileName) ? profiles[profileName] : undefined;
      if (profile) resolveJobHooks(profile.jobHooks);
    }

    let updated = 0;
    let refreshed = 0;
    const restarts = new Map<string, { ids: string[]; total: number }>();

    for (const [profileName, profileEntries] of byProfile) {
      const profile = Object.hasOwn(profiles, profileName) ? profiles[profileName] : undefined;
      if (!profile) continue;

      const provider = createProvider(profile);

      s.start(`Checking for updates for "${profileName}"...`);
      const { version: latestVersion } = await provider.download();
      s.stop(`Latest: v${latestVersion}`);

      const statuses = await provider.list();
      const runningIds = new Set(statuses.filter((r) => r.status === "running").map((r) => r.id));

      for (const entry of profileEntries) {
        const wasRunning = runningIds.has(entry.id);

        if ((await provider.currentVersion(entry.id)) === latestVersion) {
          const sync = await provider.configureJobHooks(entry.id);
          if (!sync.envChanged && !sync.scriptsChanged) continue;
          refreshed++;
          if (sync.envChanged && wasRunning) {
            const pending = restarts.get(profileName) ?? { ids: [], total: profileEntries.length };
            restarts.set(profileName, { ...pending, ids: [...pending.ids, entry.id] });
          }
          s.start("");
          s.stop(`${color.green("✓")} ${entry.id} ${color.dim("(job hooks)")}`);
          continue;
        }

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
    if (refreshed > 0) log.info(`${color.green("Refreshed")} job hooks on ${refreshed} runner(s).`);
    this.printRestartHint(restarts);

    await maybeAutoCleanup(ctx);
  }

  private printRestartHint(restarts: Map<string, { ids: string[]; total: number }>) {
    if (restarts.size === 0) return;

    const lines = ["Running runners load job hook settings only when they start. Restart them once they are idle:"];
    for (const [profileName, { ids, total }] of restarts) {
      const target = ids.length === total ? profileName : `${profileName} ${ids.join(" ")}`;
      lines.push(`  ${color.green(`hydra stop ${target} && hydra start ${target}`)}`);
    }
    log.warn(lines.join("\n"));
  }
}
