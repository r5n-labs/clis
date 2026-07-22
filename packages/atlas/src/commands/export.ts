import { randomUUID } from "node:crypto";
import { type FileHandle, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { args, color, Exit, log } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { loadAtlasConfig, resolveAtlasEnv } from "../services/config";
import { serializeDotenv } from "../services/dotenv";
import { resolvePath, splitCsv } from "../utils";

const PRIVATE_FILE_MODE = 0o600;

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

    await mkdir(dirname(outputPath), { recursive: true });
    await writeOutput(outputPath, body, ctx.args.force);
    log.success(`Wrote ${color.green(outputPath)} using ${resolved.profiles.length} profile(s)`);
  }
}

async function writeOutput(outputPath: string, body: string, force: boolean): Promise<void> {
  if (force) {
    await replaceOutput(outputPath, body);
    return;
  }

  let fileHandle: FileHandle;

  try {
    fileHandle = await open(outputPath, "wx", PRIVATE_FILE_MODE);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new Exit(`Output file already exists: ${outputPath}`, "Use --force to overwrite it");
    }
    throw error;
  }

  try {
    await fileHandle.chmod(PRIVATE_FILE_MODE);
    await fileHandle.writeFile(body, "utf8");
  } finally {
    await fileHandle.close();
  }
}

async function replaceOutput(outputPath: string, body: string): Promise<void> {
  const destination = await lstat(outputPath).catch((error) => {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  });
  if (destination && !destination.isFile() && !destination.isSymbolicLink()) {
    throw new Exit(`Output path is not a regular file: ${outputPath}`);
  }

  const tempPath = join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.tmp`);
  let fileHandle: FileHandle | null = null;
  try {
    fileHandle = await open(tempPath, "wx", PRIVATE_FILE_MODE);
    await fileHandle.chmod(PRIVATE_FILE_MODE);
    await fileHandle.writeFile(body, "utf8");
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;
    await rename(tempPath, outputPath);
  } catch (error) {
    await fileHandle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
