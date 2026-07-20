import { color, Exit, log, multiselect, positionals, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { createProvider } from "../providers";
import { resolveProfile, resolveRunnerIds, selectProfile } from "../utils";
import { maybeAutoCleanup } from "./cleanup";

const startPositionals = positionals({
  profile: { description: "Profile to use" },
  ids: { description: "Runner IDs (all by default)", variadic: true },
});

type StartCtx = Ctx<Record<string, never>, typeof startPositionals>;

export class StartCommand extends BaseCommand {
  name = "start";
  description = "Start runners";
  positionals = startPositionals;

  async execute(ctx: StartCtx) {
    const { name: profileName, profile } = ctx.interactive
      ? resolveProfile(ctx.config, await selectProfile(ctx.config))
      : resolveProfile(ctx.config, ctx.positionals.profile);

    const entries = ctx.config.get("runners") ?? [];
    const profileEntries = entries.filter((e) => e.profile === profileName);

    if (profileEntries.length === 0) {
      throw new Exit(`No runners found for profile "${profileName}"`, "Run hydra create to provision runners");
    }

    const provider = createProvider(profile);
    const s = spinner();

    s.start("Fetching runner status...");
    const statuses = await provider.list();
    s.stop("Runner status fetched");

    const runningIds = new Set(statuses.filter((r) => r.status === "running").map((r) => r.id));
    const stoppedIds = profileEntries.map((e) => e.id).filter((id) => !runningIds.has(id));

    const ids = ctx.interactive
      ? await this.promptRunnerSelection(stoppedIds)
      : resolveRunnerIds(
          ctx.positionals.ids ?? [],
          profileEntries.map((e) => e.id),
        );

    let started = 0;
    for (const id of ids) {
      if (runningIds.has(id)) {
        s.start("");
        s.stop(`${color.dim("●")} ${id} ${color.dim("already running")}`);
        continue;
      }

      s.start(`Starting ${id}...`);
      await provider.start([id]);
      s.stop(`${color.green("▶")} ${id}`);
      started++;
    }

    log.info(`${color.green("Started")} ${started} runner(s).`);

    await maybeAutoCleanup(ctx);
  }

  private async promptRunnerSelection(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      throw new Exit("All runners are already running");
    }

    return multiselect({
      message: "Select runners to start",
      options: ids.map((id) => ({ label: id, value: id })),
      required: true,
    });
  }
}
