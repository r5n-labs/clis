import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export function resolvePath(path: string, baseDir = process.cwd()): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  if (isAbsolute(path)) return path;
  return resolve(baseDir, path);
}

export function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
