import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { args, Cancel, color, confirm, Exit, group, note, positionals, text } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN, DEFAULT_PROFILE, RUNNERS_DIR, SHARED_DIR } from "../constants";
import type { Profile } from "../types";

const initPositionals = positionals({ url: { description: "GitHub repository or organization URL" } });

const initArgs = args({
  force: { alias: "f", default: false, description: "Overwrite existing config", type: "boolean" },
  labels: { alias: "l", description: "Comma-separated runner labels", type: "string" },
  name: { alias: "n", description: "Base name for runners", type: "string" },
  profile: { alias: "p", description: "Profile name", type: "string" },
  runners: { alias: "c", description: "Number of runners to create", type: "number" },
});

type InitCtx = Ctx<typeof initArgs, typeof initPositionals>;

export class InitCommand extends BaseCommand {
  name = "init";
  description = "Initialize Hydra runner manager";
  positionals = initPositionals;
  args = initArgs;
  prompts = true;

  async execute(ctx: InitCtx) {
    const profileName = ctx.interactive ? await this.promptProfileName(ctx) : (ctx.args.profile ?? DEFAULT_PROFILE);

    const isNewInit = !ctx.config.exists();

    const profileExists = !isNewInit && ctx.config.get("profiles")[profileName];
    if (profileExists && !ctx.args.force) {
      if (!ctx.interactive) {
        throw new Exit(`Profile "${profileName}" already exists. Use --force to overwrite.`);
      }
      const overwrite = await confirm({
        initialValue: false,
        message: `Profile "${profileName}" already exists. Overwrite?`,
      });
      if (!overwrite) return;
    }

    await this.ensureDirectories();

    const profile = ctx.interactive ? await this.runInitForm() : this.buildProfileFromArgs(ctx);
    const profiles = isNewInit ? {} : { ...ctx.config.get("profiles") };
    profiles[profileName] = profile;

    ctx.config.set("profiles", profiles);
    if (!ctx.config.get("defaultProfile")) {
      ctx.config.set("defaultProfile", profileName);
    }

    note(
      [
        `${color.dim("Profile:")} ${profileName}`,
        `${color.dim("URL:")} ${profile.url}`,
        `${color.dim("Runners:")} ${profile.numberOfMachines}`,
        `${color.dim("Name:")} ${profile.name}`,
        profile.labels ? `${color.dim("Labels:")} ${profile.labels}` : "",
        "",
        `Run ${color.green(`${CLI_BIN} create${profileName !== ctx.config.get("defaultProfile") ? ` ${profileName}` : ""}`)} to provision runners.`,
      ]
        .filter(Boolean)
        .join("\n"),
      color.green(isNewInit ? "Hydra initialized" : `Profile "${profileName}" added`),
    );
  }

  private async promptProfileName(ctx: InitCtx): Promise<string> {
    return text({ initialValue: ctx.args.profile ?? DEFAULT_PROFILE, message: "Profile name" });
  }

  private async ensureDirectories() {
    if (!existsSync(SHARED_DIR)) {
      await mkdir(SHARED_DIR, { recursive: true });
    }
    if (!existsSync(RUNNERS_DIR)) {
      await mkdir(RUNNERS_DIR, { recursive: true });
    }
  }

  private async runInitForm(): Promise<Profile> {
    const values = await group(
      {
        url: () =>
          text({
            message: "GitHub repository or organization URL",
            placeholder: "https://github.com/owner/repo",
            validate: (v): string | undefined => {
              if (!v) return "URL is required";
              try {
                new URL(v);
              } catch {
                return "Must be a valid URL";
              }
              return undefined;
            },
          }),
        name: () => text({ initialValue: "runner", message: "Base name for runners", placeholder: "runner" }),
        runners: () =>
          text({
            initialValue: "1",
            message: "Number of runners",
            placeholder: "1",
            validate: (v): string | undefined => {
              if (!v) return "Must be a positive number";
              const n = Number.parseInt(v, 10);
              if (Number.isNaN(n) || n < 1) return "Must be a positive number";
              return undefined;
            },
          }),
        labels: () =>
          text({ message: "Additional labels (comma-separated, optional)", placeholder: "self-hosted,macOS,ARM64" }),
      },
      {
        onCancel: () => {
          throw new Cancel();
        },
      },
    );

    return {
      directory: RUNNERS_DIR,
      labels: values.labels || undefined,
      name: values.name,
      numberOfMachines: Number.parseInt(values.runners, 10) || 1,
      os: this.detectOs(),
      overwrite: false,
      provider: "github",
      run: false,
      url: values.url,
    };
  }

  private buildProfileFromArgs(ctx: InitCtx): Profile {
    if (!ctx.positionals.url) {
      throw new Exit("URL is required", "Usage: hydra init <url>");
    }

    this.validateUrl(ctx.positionals.url);
    this.validateRunnerCount(ctx.args.runners);

    return {
      directory: RUNNERS_DIR,
      labels: ctx.args.labels,
      name: ctx.args.name ?? "runner",
      numberOfMachines: ctx.args.runners ?? 1,
      os: this.detectOs(),
      overwrite: false,
      provider: "github",
      run: false,
      url: ctx.positionals.url,
    };
  }

  private validateUrl(url: string) {
    try {
      new URL(url);
    } catch {
      throw new Exit(`Invalid URL: ${url}`);
    }
  }

  private validateRunnerCount(count?: number) {
    if (count !== undefined && count < 1) {
      throw new Exit("Runner count must be at least 1");
    }
  }

  private detectOs() {
    const platform = process.platform;
    if (platform === "darwin") return "osx" as const;
    if (platform === "win32") return "windows" as const;
    return "linux" as const;
  }
}
