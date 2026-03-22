import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import type { DiffStatus } from "../types";

export async function diffEntry(
  sourcePath: string,
  storePath: string,
  entryType: "file" | "directory",
): Promise<DiffStatus> {
  return entryType === "file"
    ? diffFile(sourcePath, storePath)
    : diffDirectory(sourcePath, storePath);
}

export async function diffFile(source: string, store: string): Promise<DiffStatus> {
  const sourceExists = existsSync(source);
  const storeExists = existsSync(store);

  if (!sourceExists && !storeExists) return "unchanged";
  if (sourceExists && !storeExists) return "added";
  if (!sourceExists && storeExists) return "deleted";

  const sourceContent = await Bun.file(source).arrayBuffer();
  const storeContent = await Bun.file(store).arrayBuffer();

  const sourceHash = Bun.hash(new Uint8Array(sourceContent));
  const storeHash = Bun.hash(new Uint8Array(storeContent));

  return sourceHash === storeHash ? "unchanged" : "modified";
}

export async function diffDirectory(source: string, store: string): Promise<DiffStatus> {
  const sourceExists = existsSync(source);
  const storeExists = existsSync(store);

  if (!sourceExists && !storeExists) return "unchanged";
  if (sourceExists && !storeExists) return "added";
  if (!sourceExists && storeExists) return "deleted";

  const sourceFiles = collectFiles(source, source);
  const storeFiles = collectFiles(store, store);

  const allPaths = new Set([...sourceFiles, ...storeFiles]);

  for (const relativePath of allPaths) {
    const status = await diffFile(join(source, relativePath), join(store, relativePath));
    if (status !== "unchanged") return "modified";
  }

  return "unchanged";
}

function collectFiles(dir: string, root: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectFiles(full, root));
    } else {
      results.push(relative(root, full));
    }
  }

  return results;
}
