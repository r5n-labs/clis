import { Cancel, args, color, group, note, select, text } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN, DEFAULT_ATLAS_CONFIG } from "../constants";
import type { AtlasConfig } from "../types";

const initArgs = args({
  default: { alias: "d", default: false, description: "Use default config", type: "boolean" },
  force: { alias: "f", default: false, description: "Overwrite existing config", type: "boolean" },
});

type InitCtx = Ctx<typeof initArgs>;

export class InitCommand extends BaseCommand {
  name = "init";
  description = "Initialize atlas configuration";
  args = initArgs;
  prompts = true;

  async execute(ctx: InitCtx): Promise<void> {
    const { default: useDefault, force } = ctx.args;

    if (useDefault) {
      ctx.config.save(DEFAULT_ATLAS_CONFIG);
      this.displaySuccessNote(ctx.cli.version);
      return;
    }

    if (ctx.config.exists() && !force) {
      note(color.yellow("Config already exists. Use --force to overwrite."));
      return;
    }

    if (!ctx.interactive) {
      ctx.config.save(DEFAULT_ATLAS_CONFIG);
      this.displaySuccessNote(ctx.cli.version);
      return;
    }

    const config = await this.runInitForm();
    ctx.config.save(config);
    this.displaySuccessNote(ctx.cli.version);
  }

  private async runInitForm(): Promise<AtlasConfig> {
    const values = await group(
      {
        ignore: () =>
          text({
            initialValue: DEFAULT_ATLAS_CONFIG.ignore.join(","),
            message: "Ignore patterns (comma-separated)",
            placeholder: "node_modules,.git,dist,build",
          }),
        maxDepth: () =>
          text({
            initialValue: String(DEFAULT_ATLAS_CONFIG.maxDepth),
            message: "Max directory depth",
            placeholder: "10",
            validate: (v) => {
              const n = Number(v);
              if (Number.isNaN(n) || n < 1) return "Must be a positive number";
              return undefined;
            },
          }),
        outputFormat: () =>
          select<"json" | "yaml">({
            initialValue: DEFAULT_ATLAS_CONFIG.output.format,
            message: "Output format",
            options: [
              { label: "JSON", value: "json" },
              { label: "YAML", value: "yaml" },
            ],
          }),
      },
      {
        onCancel: () => {
          throw new Cancel();
        },
      },
    );

    return {
      ignore: values.ignore
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      maxDepth: Number(values.maxDepth),
      output: { format: values.outputFormat },
    };
  }

  private displaySuccessNote(version?: string) {
    note(
      `${color.magenta(`${color.bold("Atlas ")}${color.underline(color.italic(`v${version ?? "unknown"}`))}`)}${color.green(" is ready to explore.")}

You can start by running ${color.green(CLI_BIN)}${color.blue(" map")} to map your codebase.
`,
    );
  }
}
