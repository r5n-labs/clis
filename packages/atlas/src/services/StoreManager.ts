import { cp, mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { TrackedEntry } from "../types";

export class StoreManager {
  constructor(private storeRoot: string) {}

  async snapshot(entry: TrackedEntry): Promise<void> {
    const source = resolvePath(entry.source);
    const dest = this.getStorePath(entry);

    await mkdir(dest, { recursive: true });

    const isDir = entry.type === "directory";
    await cp(source, join(dest, getBaseName(source)), { recursive: isDir });
  }

  async restore(entry: TrackedEntry): Promise<void> {
    const source = resolvePath(entry.source);
    const stored = join(this.getStorePath(entry), getBaseName(source));

    const parentDir = resolve(source, "..");
    await mkdir(parentDir, { recursive: true });

    const isDir = entry.type === "directory";
    await cp(stored, source, { recursive: isDir });
  }

  getStorePath(entry: TrackedEntry): string {
    return join(this.storeRoot, entry.id);
  }

  async exists(entry: TrackedEntry): Promise<boolean> {
    try {
      await stat(this.getStorePath(entry));
      return true;
    } catch {
      return false;
    }
  }

  async clean(entry: TrackedEntry): Promise<void> {
    await rm(this.getStorePath(entry), { recursive: true, force: true });
  }
}

function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

function getBaseName(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? p;
}
