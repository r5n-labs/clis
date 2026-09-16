import { existsSync } from "node:fs";
import { join } from "node:path";
import { color, Exit, log, positionals, spinner, text, validateKnownArgs } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { createProvider } from "../providers";
import type { RunnerEntry } from "../types";
import { resolveProfile, selectProfile } from "../utils";

const createPositionals = positionals({
  profile: { description: "Profile to use" },
  count: { description: "Runner count override" },
});

type CreateCtx = Ctx<Record<string, never>, typeof createPositionals>;

export class CreateCommand extends BaseCommand {
  name = "create";
  description = "Download and register runners";
  positionals = createPositionals;

  async execute(ctx: CreateCtx) {
    validateKnownArgs(ctx.args, this.args, "Run 'hydra create --help' for supported options");
    const { name: profileName, profile } = ctx.interactive
      ? resolveProfile(ctx.config, await selectProfile(ctx.config))
      : resolveProfile(ctx.config, ctx.positionals.profile);

    const count = ctx.interactive
      ? await this.promptCount(profile.numberOfMachines)
      : ctx.positionals.count
        ? Number.parseInt(ctx.positionals.count, 10)
        : profile.numberOfMachines;

    if (!count || count < 1) {
      throw new Exit("Runner count must be at least 1");
    }

    const entries: RunnerEntry[] = ctx.config.get("runners") ?? [];
    const existing = entries.filter((e) => e.profile === profileName);
    const toCreate = count - existing.length;

    if (toCreate <= 0) {
      log.warn(`Already have ${existing.length} runner(s) for profile "${profileName}". Nothing to create.`);
      return;
    }

    const provider = createProvider(profile);
    const s = spinner();
    s.start("Downloading runner binary...");
    const { version } = await provider.download();
    s.stop(`Runner v${version} ready`);

    const existingIds = new Set(entries.map((e) => e.id));
    let nextIndex = 1;

    for (let created = 0; created < toCreate; ) {
      const id = `${profile.name}-${nextIndex++}`;
      if (existingIds.has(id)) continue;
      created++;

      const entry: RunnerEntry = {
        createdAt: new Date().toISOString(),
        directory: join(profile.directory, id),
        id,
        name: id,
        profile: profileName,
        provider: profile.provider,
        url: profile.url,
      };
      const directoryExisted = existsSync(entry.directory);
      s.start(`Registering ${id}...`);
      try {
        await provider.create([id]);
      } finally {
        if (!directoryExisted && existsSync(join(entry.directory, ".runner"))) {
          entries.push(entry);
          ctx.config.set("runners", entries);
        }
      }
      s.stop(`${color.green("+")} ${id}`);
    }

    const isDefault = profileName === ctx.config.get("defaultProfile");
    const profileSuffix = isDefault ? "" : ` ${profileName}`;
    log.info(
      `${color.green("Created")} ${toCreate} runner(s) for "${profileName}". Run ${color.green(`hydra start${profileSuffix}`)} to start them.`,
    );
  }

  private async promptCount(defaultCount: number): Promise<number> {
    const value = await text({
      initialValue: String(defaultCount),
      message: "Number of runners to create",
      validate: (v): string | undefined => {
        const n = Number.parseInt(v ?? "", 10);
        if (Number.isNaN(n) || n < 1) return "Must be a positive number";
        return undefined;
      },
    });
    return Number.parseInt(value, 10);
  }
}
