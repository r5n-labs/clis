import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { args, color, Exit, log } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { loadAtlasConfig, resolveAtlasEnv } from "../services/config";
import { serializeDotenv } from "../services/dotenv";
import { resolvePath, splitCsv } from "../utils";

const exportArgs = args({
  cwd: { description: "Working directory override", type: "string" },
  force: { alias: "f", default: false, description: "Overwrite an existing file", type: "boolean" },
  out: { alias: "o", description: "Output .env path", type: "string" },
  profile: { alias: "p", description: "Comma-separated profiles to apply", type: "string" },
  stdout: { default: false, description: "Print to stdout instead of writing a file", type: "boolean" },
});

type ExportCtx = Ctx<typeof exportArgs>;

export class ExportCommand extends BaseCommand {
  name = "export";
  description = "Export resolved Atlas env to a dotenv file";
  args = exportArgs;

  async execute(ctx: ExportCtx): Promise<void> {
    const cwd = ctx.args.cwd ?? process.cwd();
    const loaded = loadAtlasConfig({ cwd });
    const resolved = resolveAtlasEnv(loaded, { profiles: splitCsv(ctx.args.profile) });
    const body = serializeDotenv(resolved.env);
    const outputPath = ctx.args.out ? resolvePath(ctx.args.out, loaded.projectRoot ?? loaded.cwd) : resolved.exportFile;

    if (ctx.args.stdout) {
      process.stdout.write(body);
      return;
    }

    if (existsSync(outputPath) && !ctx.args.force) {
      throw new Exit(`Output file already exists: ${outputPath}`, "Use --force to overwrite it");
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, body, "utf8");
    log.success(`Wrote ${color.green(outputPath)} using ${resolved.profiles.length} profile(s)`);
  }
}
