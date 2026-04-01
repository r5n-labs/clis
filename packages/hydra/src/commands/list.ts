import { Exit, color, log } from "@r5n/cli-core";
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
    let totalRunners = 0;
    let totalRunning = 0;

    const lines: string[] = [];

    for (const name of profileNames) {
      const profile = profiles[name] as Profile;
      const provider = createProvider(profile);
      const statuses = await provider.list();

      if (lines.length > 0) lines.push("");

      lines.push(`${color.bold(name)} ${color.dim(profile.url)}`);

      const profileRunnerIds = new Set(entries.filter((e) => e.profile === name).map((e) => e.id));
      const runners = statuses
        .filter((r) => profileRunnerIds.has(r.id))
        .sort((a, b) => a.name.localeCompare(b.name));

      this.formatRunners(runners, lines);
      totalRunners += runners.length;
      totalRunning += runners.filter((r) => r.status === "running").length;
    }

    lines.push("");
    lines.push(color.dim(`${totalRunners} runner(s) total, ${totalRunning} running`));
    log.info(lines.join("\n"));
  }

  private formatRunners(runners: RunnerInfo[], lines: string[]) {
    if (runners.length === 0) {
      lines.push(color.dim("  No runners."));
      return;
    }

    for (const runner of runners) {
      const statusColor = STATUS_COLORS[runner.status] ?? color.dim;
      const pid = runner.pid ? color.dim(` (pid: ${runner.pid})`) : "";
      lines.push(`  ${statusColor("●")} ${runner.name} ${statusColor(runner.status)}${pid}`);
    }
  }
}
