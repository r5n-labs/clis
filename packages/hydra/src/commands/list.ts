import { Exit, color, log, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { createProvider } from "../providers";
import type { RunnerInfo } from "../providers";
import type { Profile } from "../types";

type ListCtx = Ctx;

const STATUS_COLORS: Record<string, (text: string) => string> = {
  registered: color.yellow,
  running: color.green,
  stopped: color.red,
  unknown: color.dim,
};

export class ListCommand extends BaseCommand {
  name = "list";
  description = "List runners and their status";

  async execute(ctx: ListCtx) {
    const profiles = ctx.config.get("profiles");
    const profileNames = Object.keys(profiles);

    if (profileNames.length === 0) {
      throw new Exit("No profiles configured", "Run hydra init to set up a profile");
    }

    const entries = ctx.config.get("runners") ?? [];
    const firstProfile = profiles[profileNames[0] as string] as Profile;
    const s = spinner();

    s.start("Fetching runner status...");
    const provider = createProvider(firstProfile);
    const allStatuses = await provider.list();
    s.stop("Runner status fetched");

    const statusMap = new Map(allStatuses.map((r) => [r.id, r]));
    let totalRunners = 0;
    let totalRunning = 0;

    for (const name of profileNames) {
      const profile = profiles[name] as Profile;
      log.info(`${color.bold(name)} ${color.dim(profile.url)}`);
      const profileRunnerIds = entries.filter((e) => e.profile === name).map((e) => e.id);
      const runners = profileRunnerIds
        .map((id) => statusMap.get(id))
        .filter((r): r is RunnerInfo => r !== undefined);

      this.printRunners(runners);
      totalRunners += runners.length;
      totalRunning += runners.filter((r) => r.status === "running").length;
    }

    log.info(color.dim(`  ${totalRunners} runner(s) total, ${totalRunning} running`));
  }

  private printRunners(runners: RunnerInfo[]) {
    if (runners.length === 0) {
      log.info(color.dim("  No runners."));
      return;
    }

    for (const runner of runners) {
      const statusColor = STATUS_COLORS[runner.status] ?? color.dim;
      const pid = runner.pid ? color.dim(` (pid: ${runner.pid})`) : "";
      log.info(`  ${statusColor("●")} ${runner.name} ${statusColor(runner.status)}${pid}`);
    }
  }
}
