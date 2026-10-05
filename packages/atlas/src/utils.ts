import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { Exit } from "@r5n/cli-core";

export function validatePathOption(value: string | undefined, flag: string, hint: string): void {
  if (value !== undefined && value.trim().length === 0) {
    throw new Exit(`--${flag} must not be empty`, hint);
  }
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function homeDirectory(): string {
  return process.env.HOME || homedir();
}

export function resolvePath(path: string, baseDir = process.cwd()): string {
  if (path === "~") return homeDirectory();
  if (path.startsWith("~/")) return resolve(homeDirectory(), path.slice(2));
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
