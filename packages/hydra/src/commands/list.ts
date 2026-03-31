import { Exit, args, color, log } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { DEFAULT_PROFILE } from "../constants";
import { createProvider } from "../providers";

const listArgs = args({
  profile: { alias: "p", description: "Profile name to use", type: "string" },
});

type ListCtx = Ctx<typeof listArgs>;

const STATUS_COLORS: Record<string, (text: string) => string> = {
  registered: color.yellow,
  running: color.green,
  stopped: color.red,
  unknown: color.dim,
};

export class ListCommand extends BaseCommand {
  name = "list";
  description = "List runners and their status";
  args = listArgs;

  async execute(ctx: ListCtx) {
    const profileName = ctx.args.profile ?? ctx.config.get("defaultProfile") ?? DEFAULT_PROFILE;
    const profile = ctx.config.get("profiles")[profileName];
    if (!profile) {
      throw new Exit(`Profile "${profileName}" not found`);
    }

    const provider = createProvider(profile);
    const runners = await provider.list();

    if (runners.length === 0) {
      log.info(color.dim("No runners found."));
      return;
    }

    for (const runner of runners) {
      const statusColor = STATUS_COLORS[runner.status] ?? color.dim;
      const pid = runner.pid ? color.dim(` (pid: ${runner.pid})`) : "";
      log.info(`  ${statusColor("●")} ${runner.name} ${statusColor(runner.status)}${pid}`);
    }

    const running = runners.filter((r) => r.status === "running").length;
    log.info(color.dim(`  ${runners.length} runner(s), ${running} running`));
  }
}
