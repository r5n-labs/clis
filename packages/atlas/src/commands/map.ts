import { resolve } from "node:path";
import { args } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { scan } from "../services/CodebaseScanner";
import { analyzeImports, flattenFileTree } from "../services/ImportAnalyzer";
import type { AtlasScanResult } from "../types";

type OutputFormat = "json" | "yaml";

const mapArgs = args({
  output: { alias: "o", description: "Output file path (stdout if not set)", type: "string" },
  format: { alias: "f", default: "json", description: "Output format (json | yaml)", type: "string" },
  depth: { alias: "d", description: "Max directory depth", type: "number" },
  json: { default: false, description: "Shorthand for --format json", type: "boolean" },
  stats: { default: false, description: "Include size statistics", type: "boolean" },
  deps: { default: false, description: "Include dependency analysis", type: "boolean" },
});

type MapCtx = Ctx<typeof mapArgs>;

function isOutputFormat(value: string): value is OutputFormat {
  return value === "json" || value === "yaml";
}

export function toYaml(value: unknown, indent: number = 0): string {
  const prefix = "  ".repeat(indent);

  if (value === null || value === undefined) return `${prefix}null\n`;
  if (typeof value === "boolean") return `${prefix}${value}\n`;
  if (typeof value === "number") return `${prefix}${value}\n`;
  if (typeof value === "string") {
    const needsQuotes = value === "" || value.includes(":") || value.includes("#") || value.includes("\n");
    return needsQuotes ? `${prefix}"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n` : `${prefix}${value}\n`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return `${prefix}[]\n`;
    let result = "";
    for (const item of value) {
      if (typeof item === "object" && item !== null) {
        const inner = toYaml(item, indent + 1).trimStart();
        result += `${prefix}- ${inner}`;
      } else {
        const inner = toYaml(item, 0).trimEnd();
        result += `${prefix}- ${inner}\n`;
      }
    }
    return result;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${prefix}{}\n`;
    let result = "";
    for (const [key, val] of entries) {
      if (val === undefined) continue;
      if (typeof val === "object" && val !== null) {
        result += `${prefix}${key}:\n${toYaml(val, indent + 1)}`;
      } else {
        const inner = toYaml(val, 0).trimEnd();
        result += `${prefix}${key}: ${inner}\n`;
      }
    }
    return result;
  }

  return `${prefix}${String(value)}\n`;
}

export class MapCommand extends BaseCommand {
  name = "map";
  description = "Generate codebase structure map";
  args = mapArgs;

  async execute(ctx: MapCtx): Promise<void> {
    const config = ctx.config;
    const ignore = config.get("ignore");
    const maxDepth = ctx.args.depth || config.get("maxDepth");
    const includeStats = ctx.args.stats;
    const outputConfig = config.get("output");

    const rawFormat = ctx.args.json ? "json" : ctx.args.format || outputConfig.format;
    const format: OutputFormat = isOutputFormat(rawFormat) ? rawFormat : "json";
    const outputPath = ctx.args.output || outputConfig.file;

    const root = resolve(process.cwd());

    const scanResult = await scan({
      root,
      ignore,
      maxDepth,
      includeStats,
    });

    const result: AtlasScanResult = scanResult;

    if (ctx.args.deps) {
      const files = flattenFileTree(scanResult.tree);
      result.dependencies = await analyzeImports({ root, files, ignore });
    }

    const formatted = this.formatOutput(result, format);

    if (outputPath) {
      await Bun.write(resolve(outputPath), formatted);
    } else {
      console.log(formatted);
    }
  }

  private formatOutput(result: AtlasScanResult, format: OutputFormat): string {
    if (format === "yaml") return toYaml(result).trimEnd();
    return JSON.stringify(result, null, 2);
  }
}
