import { args, color, Exit, log, positionals } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { loadAtlasConfig } from "../services/config";

const commonArgs = args({
  cwd: { description: "Working directory override", type: "string" },
  json: { alias: "j", default: false, description: "Output as JSON", type: "boolean" },
});

const showPositionals = positionals({ profile: { description: "Profile name", required: true } });

type ListCtx = Ctx<typeof commonArgs>;
type ShowCtx = Ctx<typeof commonArgs, typeof showPositionals>;

export class ProfilesCommand extends BaseCommand {
  name = "profiles";
  description = "Inspect Atlas profiles";

  init(): void {
    this.registerSubcommands([new ProfilesListCommand(), new ProfilesShowCommand()]);
  }
}

export class ProfilesListCommand extends BaseCommand {
  name = "list";
  description = "List available profiles";
  args = commonArgs;

  async execute(ctx: ListCtx): Promise<void> {
    const loaded = loadAtlasConfig({ cwd: ctx.args.cwd ?? process.cwd() });
    const names = Object.keys(loaded.config.profiles).sort();

    if (ctx.args.json) {
      process.stdout.write(`${JSON.stringify(names, null, 2)}\n`);
      return;
    }

    if (names.length === 0) {
      log.info("No Atlas profiles configured");
      return;
    }

    for (const name of names) {
      const profile = loaded.config.profiles[name];
      const description = profile?.description ? color.dim(` - ${profile.description}`) : "";
      log.info(`${color.cyan(name)}${description}`);
    }
  }
}

export class ProfilesShowCommand extends BaseCommand {
  name = "show";
  description = "Show one Atlas profile";
  args = commonArgs;
  positionals = showPositionals;

  async execute(ctx: ShowCtx): Promise<void> {
    const loaded = loadAtlasConfig({ cwd: ctx.args.cwd ?? process.cwd() });
    const profile = loaded.config.profiles[ctx.positionals.profile];

    if (!profile) {
      throw new Exit(`Unknown Atlas profile: ${ctx.positionals.profile}`, "Run 'atlas profiles list'");
    }

    if (ctx.args.json) {
      process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
      return;
    }

    log.info(`${color.bold(ctx.positionals.profile)}\n${JSON.stringify(profile, null, 2)}`);
  }
}
