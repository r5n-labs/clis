import { Exit, args, color, log, positionals, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { DEFAULT_PROFILE } from "../constants";
import { createProvider } from "../providers";
import { resolveRunnerIds } from "../utils";

const startPositionals = positionals({
  ids: { description: "Runner IDs to start, or 'all'", variadic: true },
});

const startArgs = args({
  profile: { alias: "p", description: "Profile name to use", type: "string" },
});

type StartCtx = Ctx<typeof startArgs, typeof startPositionals>;

export class StartCommand extends BaseCommand {
  name = "start";
  description = "Start runners";
  positionals = startPositionals;
  args = startArgs;

  async execute(ctx: StartCtx) {
    const profileName = ctx.args.profile ?? ctx.config.get("defaultProfile") ?? DEFAULT_PROFILE;
    const profile = ctx.config.get("profiles")[profileName];
    if (!profile) {
      throw new Exit(`Profile "${profileName}" not found`);
    }

    const entries = ctx.config.get("runners") ?? [];
    const profileEntries = entries.filter((e) => e.profile === profileName);
    const ids = resolveRunnerIds(ctx.positionals.ids, profileEntries.map((e) => e.id));

    const provider = createProvider(profile);
    const s = spinner();
    const statuses = await provider.list();
    const runningIds = new Set(statuses.filter((r) => r.status === "running").map((r) => r.id));

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
  }
}
