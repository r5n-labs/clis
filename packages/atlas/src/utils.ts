import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { Exit } from "@r5n/cli-core";

export function resolvePath(path: string, baseDir = process.cwd()): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  if (isAbsolute(path)) return path;
  return resolve(baseDir, path);
}

export function parseProfileOption(value: string | undefined, usage: string): string[] | undefined {
  if (value === undefined) return undefined;

  const profiles = splitCsv(value);
  if (profiles.length === 0) {
    throw new Exit("--profile must include at least one profile", usage);
  }

  return profiles;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
