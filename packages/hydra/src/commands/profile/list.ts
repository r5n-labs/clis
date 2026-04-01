import { Exit, color, log, note } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { createProvider } from "../../providers";
import type { Profile } from "../../types";

type ListCtx = Ctx;

export class ProfileListCommand extends BaseCommand {
  name = "list";
  description = "List all profiles";

  async execute(ctx: ListCtx) {
    const profiles = ctx.config.get("profiles");
    const profileNames = Object.keys(profiles);

    if (profileNames.length === 0) {
      throw new Exit("No profiles configured", "Run hydra init to set up a profile");
    }

    const entries = ctx.config.get("runners") ?? [];
    const defaultProfile = ctx.config.get("defaultProfile");

    for (const name of profileNames) {
      const profile = profiles[name] as Profile;
      const provider = createProvider(profile);
      const statuses = await provider.list();

      const profileRunners = entries.filter((e) => e.profile === name);
      const runningIds = new Set(statuses.filter((r) => r.status === "running").map((r) => r.id));
      const running = profileRunners.filter((e) => runningIds.has(e.id)).length;
      const isDefault = name === defaultProfile;

      const lines = [
        `${color.dim("URL:")}      ${profile.url}`,
        `${color.dim("Provider:")} ${profile.provider}`,
        `${color.dim("OS:")}       ${profile.os}`,
        `${color.dim("Name:")}     ${profile.name}`,
        `${color.dim("Runners:")}  ${profileRunners.length}/${profile.numberOfMachines} created, ${color.green(`${running} running`)}`,
      ];

      if (profile.labels) {
        lines.push(`${color.dim("Labels:")}   ${profile.labels}`);
      }

      const title = isDefault ? `${name} ${color.dim("(default)")}` : name;
      note(lines.join("\n"), title);
    }

    log.info(color.dim(`${profileNames.length} profile(s)`));
  }
}
