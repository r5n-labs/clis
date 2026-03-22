import { resolve } from "node:path";
import { args } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { scan, type ScanResult } from "../services/CodebaseScanner";

const mapArgs = args({
  output: { alias: "o", description: "Output file path (stdout if not set)", type: "string" },
  format: { alias: "f", default: "json", description: "Output format", type: "string" },
  depth: { alias: "d", description: "Max directory depth", type: "number" },
  json: { default: false, description: "Shorthand for --format json", type: "boolean" },
  stats: { default: false, description: "Include size statistics", type: "boolean" },
});

type MapCtx = Ctx<typeof mapArgs>;

export class MapCommand extends BaseCommand {
  name = "map";
  description = "Generate codebase structure map";
  args = mapArgs;

  async execute(ctx: MapCtx): Promise<void> {
    const config = ctx.config;
    const ignore = config.get("ignore") as string[];
    const maxDepth = (ctx.args.depth as number | undefined) ?? (config.get("maxDepth") as number);
    const includeStats = ctx.args.stats as boolean;
    const outputConfig = config.get("output") as { format: string; file?: string };

    const format = ctx.args.json ? "json" : (ctx.args.format as string | undefined) ?? outputConfig.format;
    const outputPath = (ctx.args.output as string | undefined) ?? outputConfig.file;

    const root = resolve(process.cwd());

    const result = await scan({
      root,
      ignore,
      maxDepth,
      includeStats,
    });

    const formatted = this.formatOutput(result, format);

    if (outputPath) {
      await Bun.write(resolve(outputPath), formatted);
    } else {
      console.log(formatted);
    }
  }

  private formatOutput(result: ScanResult, _format: string): string {
    return JSON.stringify(result, null, 2);
  }
}
