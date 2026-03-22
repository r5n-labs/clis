import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { GistBackend } from "../../types";
import type { BackendAdapter } from "./types";

const GITHUB_API = "https://api.github.com/gists";

function resolvePath(p: string): string {
  return p.startsWith("~") ? p.replace("~", homedir()) : resolve(p);
}

function encodeFilePath(filePath: string): string {
  return filePath.replace(/\//g, "__");
}

function decodeFilePath(encoded: string): string {
  return encoded.replace(/__/g, "/");
}

type GistFile = {
  filename: string;
  content: string;
};

type GistResponse = {
  id: string;
  files: Record<string, GistFile>;
};

async function collectFiles(
  dir: string,
  prefix = ""
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const nested = await collectFiles(entryPath, relativePath);
      Object.assign(files, nested);
    } else {
      files[relativePath] = await readFile(entryPath, "utf-8");
    }
  }

  return files;
}

export function createGistAdapter(config: GistBackend): BackendAdapter {
  let gistId = config.gistId;

  const headers: Record<string, string> = {
    Authorization: `token ${config.token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "atlas-cli",
  };

  return {
    async init(): Promise<void> {
      if (gistId) return;

      try {
        const response = await fetch(GITHUB_API, {
          method: "POST",
          headers,
          body: JSON.stringify({
            description: "Atlas config sync",
            public: false,
            files: {
              ".atlas-init": { content: "initialized by atlas" },
            },
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`GitHub API returned ${response.status}: ${body}`);
        }

        const data = (await response.json()) as GistResponse;
        gistId = data.id;
        config.gistId = gistId;
      } catch (error) {
        throw new Error(
          `Failed to create gist: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async push(storePath: string): Promise<void> {
      if (!gistId) throw new Error("Gist not initialized — call init() first");

      const resolved = resolvePath(storePath);

      try {
        const localFiles = await collectFiles(resolved);
        const gistFiles: Record<string, { content: string }> = {};

        for (const [path, content] of Object.entries(localFiles)) {
          gistFiles[encodeFilePath(path)] = { content };
        }

        const response = await fetch(`${GITHUB_API}/${gistId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ files: gistFiles }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`GitHub API returned ${response.status}: ${body}`);
        }
      } catch (error) {
        throw new Error(
          `Failed to push to gist "${gistId}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async pull(storePath: string): Promise<void> {
      if (!gistId) throw new Error("Gist not initialized — call init() first");

      const resolved = resolvePath(storePath);

      try {
        const response = await fetch(`${GITHUB_API}/${gistId}`, {
          method: "GET",
          headers,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`GitHub API returned ${response.status}: ${body}`);
        }

        const data = (await response.json()) as GistResponse;

        for (const [filename, file] of Object.entries(data.files)) {
          const decoded = decodeFilePath(filename);
          const targetPath = join(resolved, decoded);
          const targetDir = join(targetPath, "..");
          await mkdir(targetDir, { recursive: true });
          await writeFile(targetPath, file.content, "utf-8");
        }
      } catch (error) {
        throw new Error(
          `Failed to pull from gist "${gistId}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}
