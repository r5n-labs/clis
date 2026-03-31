import { Exit, args, color, log, positionals, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { DEFAULT_PROFILE } from "../constants";
import { createProvider } from "../providers";
import type { RunnerEntry } from "../types";

const createPositionals = positionals({
  count: { description: "Number of runners to create (overrides profile)" },
});

const createArgs = args({
  profile: { alias: "p", description: "Profile name to use", type: "string" },
});

type CreateCtx = Ctx<typeof createArgs, typeof createPositionals>;

export class CreateCommand extends BaseCommand {
  name = "create";
  description = "Create and register runners";
  positionals = createPositionals;
  args = createArgs;

  async execute(ctx: CreateCtx) {
    const profileName = ctx.args.profile ?? ctx.config.get("defaultProfile") ?? DEFAULT_PROFILE;
    if (!profileName) {
      throw new Exit("No profile specified", "Run hydra init first or use --profile");
    }

    const profiles = ctx.config.get("profiles");
    const profile = profiles[profileName];
    if (!profile) {
      throw new Exit(`Profile "${profileName}" not found`);
    }

    const count = ctx.positionals.count ? Number.parseInt(ctx.positionals.count, 10) : profile.numberOfMachines;
    if (!count || count < 1) {
      throw new Exit("Runner count must be at least 1");
    }

    const provider = createProvider(profile);

    const s = spinner();
    s.start("Downloading runner binary...");
    const { version } = await provider.download();
    s.stop(`Runner v${version} ready`);

    const entries: RunnerEntry[] = ctx.config.get("runners") ?? [];
    const existing = entries.filter((e) => e.profile === profileName);
    const toCreate = count - existing.length;

    if (toCreate <= 0) {
      log.warn(`Already have ${existing.length} runner(s) for profile "${profileName}". Nothing to create.`);
      return;
    }

    const existingIds = new Set(entries.map((e) => e.id));
    let nextIndex = 1;

    for (let created = 0; created < toCreate; ) {
      const name = `${profile.name}-${nextIndex++}`;
      if (existingIds.has(name)) continue;
      created++;
      s.start(`Registering ${name}...`);
      const runner = await provider.create(name);
      s.stop(`${color.green("+")} ${name}`);

      entries.push({
        createdAt: new Date().toISOString(),
        directory: runner.directory,
        id: runner.id,
        name: runner.name,
        profile: profileName,
        provider: profile.provider,
        url: profile.url,
      });
    }

    ctx.config.set("runners", entries);

    log.info(`${color.green("Created")} ${toCreate} runner(s). Total: ${entries.length}. Run ${color.green("hydra start")} to start them.`);
  }
}
