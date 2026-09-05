import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { args, color, Exit, log } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { loadAtlasConfig, resolveAtlasEnv } from "../services/config";
import { serializeDotenv } from "../services/dotenv";
import { writePrivateFile } from "../services/file-output";
import { parseProfileOption, resolvePath, validateOptions, validatePathOption } from "../utils";

const PROFILE_USAGE = "Usage: atlas export --profile <name,...>";

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
    validateOptions(ctx.args, exportArgs, "Run 'atlas export --help' for supported options");
    if (ctx.args.stdout && ctx.args.out !== undefined) {
      throw new Exit(
        "--stdout cannot be combined with --out",
        "Use --stdout to print, or --out <path> to write a file",
      );
    }

    validatePathOption(ctx.args.cwd, "cwd", "Usage: atlas export --cwd <dir>");
    validatePathOption(ctx.args.out, "out", "Usage: atlas export --out <path>");
    const profiles = parseProfileOption(ctx.args.profile, PROFILE_USAGE);
    const cwd = ctx.args.cwd ?? process.cwd();
    const loaded = loadAtlasConfig({ cwd });
    const resolved = resolveAtlasEnv(loaded, { profiles });
    const body = serializeDotenv(resolved.env);

    if (ctx.args.stdout) {
      process.stdout.write(body);
      return;
    }

    const outputPath = ctx.args.out !== undefined ? resolvePath(ctx.args.out, loaded.cwd) : resolved.exportFile;

    await mkdir(dirname(outputPath), { recursive: true });
    await writePrivateFile(outputPath, body, ctx.args.force);
    log.success(`Wrote ${color.green(outputPath)} using ${resolved.profiles.length} profile(s)`);
  }
}
