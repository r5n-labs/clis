import { color, Exit, log, multiselect, positionals, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { createProvider } from "../providers";
import { resolveProfile, resolveRunnerIds, selectProfile } from "../utils";

const stopPositionals = positionals({
  profile: { description: "Profile to use" },
  ids: { description: "Runner IDs (all by default)", variadic: true },
});

type StopCtx = Ctx<Record<string, never>, typeof stopPositionals>;

export class StopCommand extends BaseCommand {
  name = "stop";
  description = "Stop runners";
  positionals = stopPositionals;

  async execute(ctx: StopCtx) {
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
    const activeIds = profileEntries.map((e) => e.id).filter((id) => runningIds.has(id));

    const ids = ctx.interactive
      ? await this.promptRunnerSelection(activeIds)
      : resolveRunnerIds(
          ctx.positionals.ids ?? [],
          profileEntries.map((e) => e.id),
        );

    let stopped = 0;
    for (const id of ids) {
      if (!runningIds.has(id)) {
        s.start("");
        s.stop(`${color.dim("●")} ${id} ${color.dim("not running")}`);
        continue;
      }

      s.start(`Stopping ${id}...`);
      await provider.stop([id]);
      s.stop(`${color.red("■")} ${id}`);
      stopped++;
    }

    log.info(`${color.green("Stopped")} ${stopped} runner(s).`);
  }

  private async promptRunnerSelection(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      throw new Exit("No runners are currently running");
    }

    return multiselect({
      message: "Select runners to stop",
      options: ids.map((id) => ({ label: id, value: id })),
      required: true,
    });
  }
}
