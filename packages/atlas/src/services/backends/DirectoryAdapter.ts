import { homedir } from "node:os";
import { resolve } from "node:path";
import { cp, mkdir } from "node:fs/promises";
import type { DirectoryBackend } from "../../types";
import type { BackendAdapter } from "./types";

function resolvePath(p: string): string {
  return p.startsWith("~") ? p.replace("~", homedir()) : resolve(p);
}

export function createDirectoryAdapter(
  config: DirectoryBackend
): BackendAdapter {
  const targetDir = resolvePath(config.path);

  return {
    async init(): Promise<void> {
      try {
        await mkdir(targetDir, { recursive: true });
      } catch (error) {
        throw new Error(
          `Failed to create directory "${targetDir}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async push(storePath: string): Promise<void> {
      const resolved = resolvePath(storePath);

      try {
        await cp(resolved, targetDir, { recursive: true });
      } catch (error) {
        throw new Error(
          `Failed to push to directory "${targetDir}" from "${resolved}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async pull(storePath: string): Promise<void> {
      const resolved = resolvePath(storePath);

      try {
        await mkdir(resolved, { recursive: true });
        await cp(targetDir, resolved, { recursive: true });
      } catch (error) {
        throw new Error(
          `Failed to pull from directory "${targetDir}" to "${resolved}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}
