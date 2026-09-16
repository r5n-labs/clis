import { randomUUID } from "node:crypto";
import { type FileHandle, link, lstat, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Exit } from "@r5n/cli-core";
import { hasErrorCode } from "../utils";

const PRIVATE_FILE_MODE = 0o600;

export async function writePrivateFile(
  outputPath: string,
  body: string,
  force: boolean,
  label = "Output file",
): Promise<void> {
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
    if (force) {
      await rename(tempPath, outputPath);
    } else {
      await link(tempPath, outputPath).catch((error) => {
        if (hasErrorCode(error, "EEXIST")) {
          throw new Exit(`${label} already exists: ${outputPath}`, "Use --force to overwrite it");
        }
        throw error;
      });
      await rm(tempPath);
    }
  } catch (error) {
    await fileHandle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
