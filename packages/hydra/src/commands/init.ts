import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { args, Cancel, color, confirm, Exit, group, note, positionals, text, validateKnownArgs } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN, DEFAULT_PROFILE, RUNNERS_DIR, SHARED_DIR } from "../constants";
import { parseGitHubUrl } from "../providers";
import type { Profile } from "../types";
import { parseRunnerCount, validateRunnerCount } from "../utils";

const DEFAULT_RUNNER_COUNT = 1;

const initPositionals = positionals({ url: { description: "GitHub repository or organization URL" } });

const initArgs = args({
  force: { alias: "f", default: false, description: "Overwrite an existing profile", type: "boolean" },
  labels: { alias: "l", description: "Set comma-separated runner labels", type: "string" },
  name: { alias: "n", description: "Set the runner name prefix", type: "string" },
  profile: { alias: "p", description: "Set the profile name", type: "string" },
  runners: { alias: "c", description: "Set the runner count", type: "number" },
});

type InitCtx = Ctx<typeof initArgs, typeof initPositionals>;

export class InitCommand extends BaseCommand {
  name = "init";
  description = "Set up a runner profile";
  positionals = initPositionals;
  args = initArgs;
  prompts = true;

  async execute(ctx: InitCtx) {
    validateKnownArgs(ctx.args, this.args, "Run 'hydra init --help' for supported options");
    const profileName = ctx.interactive ? await this.promptProfileName(ctx) : (ctx.args.profile ?? DEFAULT_PROFILE);

    const isNewInit = !ctx.config.exists();

    const profileExists = !isNewInit && Object.hasOwn(ctx.config.get("profiles"), profileName);
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

    const profile = ctx.interactive ? await this.runInitForm() : this.buildProfileFromArgs(ctx);
    await this.ensureDirectories();
    const profiles = { ...(isNewInit ? {} : ctx.config.get("profiles")), [profileName]: profile };

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
                parseGitHubUrl(v);
              } catch {
                return "Must be a GitHub repository or organization URL (https://github.com/<owner>/<repo> or https://github.com/<org>)";
              }
              return undefined;
            },
          }),
        name: () => text({ initialValue: "runner", message: "Base name for runners", placeholder: "runner" }),
        runners: () =>
          text({
            initialValue: String(DEFAULT_RUNNER_COUNT),
            message: "Number of runners",
            placeholder: "1",
            validate: validateRunnerCount,
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
      numberOfMachines: parseRunnerCount(values.runners),
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

    return {
      directory: RUNNERS_DIR,
      labels: ctx.args.labels,
      name: ctx.args.name ?? "runner",
      numberOfMachines: parseRunnerCount(ctx.args.runners ?? DEFAULT_RUNNER_COUNT),
      os: this.detectOs(),
      overwrite: false,
      provider: "github",
      run: false,
      url: ctx.positionals.url,
    };
  }

  private validateUrl(url: string) {
    try {
      parseGitHubUrl(url);
    } catch (error) {
      throw new Exit(
        error instanceof Error ? error.message : `Invalid GitHub URL: ${url}`,
        "Expected https://github.com/<owner>/<repo> or https://github.com/<org>",
      );
    }
  }

  private detectOs() {
    const platform = process.platform;
    if (platform === "darwin") return "osx" as const;
    if (platform === "win32") return "windows" as const;
    return "linux" as const;
  }
}
