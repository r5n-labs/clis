import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { $ } from "bun";
import type { GitBackend } from "../../types";
import type { BackendAdapter } from "./types";

function resolvePath(p: string): string {
  return p.startsWith("~") ? p.replace("~", homedir()) : resolve(p);
}

export function createGitAdapter(config: GitBackend): BackendAdapter {
  const branch = config.branch ?? "main";
  const repoDir = resolvePath("~/.atlas/.git-remote");

  return {
    async init(): Promise<void> {
      if (existsSync(join(repoDir, ".git"))) {
        try {
          await $`git -C ${repoDir} fetch origin`.quiet();
          await $`git -C ${repoDir} checkout ${branch}`.quiet();
        } catch (error) {
          throw new Error(
            `Failed to fetch/checkout branch "${branch}" in ${repoDir}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return;
      }

      try {
        await $`mkdir -p ${repoDir}`.quiet();
        await $`git clone --branch ${branch} ${config.url} ${repoDir}`.quiet();
      } catch (error) {
        throw new Error(
          `Failed to clone repo "${config.url}" (branch: ${branch}): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async push(storePath: string): Promise<void> {
      const resolved = resolvePath(storePath);

      try {
        await $`cp -a ${resolved}/. ${repoDir}/`.quiet();
        await $`git -C ${repoDir} add -A`.quiet();

        const status = await $`git -C ${repoDir} status --porcelain`.quiet();
        if (!status.stdout.toString().trim()) return;

        await $`git -C ${repoDir} commit -m "atlas: sync configs"`.quiet();
        await $`git -C ${repoDir} push origin ${branch}`.quiet();
      } catch (error) {
        throw new Error(
          `Failed to push to git backend "${config.url}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async pull(storePath: string): Promise<void> {
      const resolved = resolvePath(storePath);

      try {
        await $`git -C ${repoDir} pull origin ${branch}`.quiet();
        await $`mkdir -p ${resolved}`.quiet();
        await $`cp -a ${repoDir}/. ${resolved}/`.quiet();
      } catch (error) {
        throw new Error(
          `Failed to pull from git backend "${config.url}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}
