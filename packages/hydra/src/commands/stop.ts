import { Exit, args, color, log, positionals, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { DEFAULT_PROFILE } from "../constants";
import { createProvider } from "../providers";
import { resolveRunnerIds } from "../utils";

const stopPositionals = positionals({
  ids: { description: "Runner IDs to stop, or 'all'", variadic: true },
});

const stopArgs = args({
  profile: { alias: "p", description: "Profile name to use", type: "string" },
});

type StopCtx = Ctx<typeof stopArgs, typeof stopPositionals>;

export class StopCommand extends BaseCommand {
  name = "stop";
  description = "Stop runners";
  positionals = stopPositionals;
  args = stopArgs;

  async execute(ctx: StopCtx) {
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
}
