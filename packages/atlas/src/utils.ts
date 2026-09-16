import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { type ArgDefinition, Exit } from "@r5n/cli-core";

const ALIAS_FLAG_LENGTH = 1;

export function validateOptions(
  values: Record<string, unknown>,
  definitions: Record<string, ArgDefinition>,
  hint: string,
): void {
  const allowed = new Set(
    Object.entries(definitions).flatMap(([key, value]) => (value.alias ? [key, value.alias] : [key])),
  );
  const unknown = Object.keys(values).find((key) => !allowed.has(key));
  if (unknown === undefined) return;
  const flag = unknown.length === ALIAS_FLAG_LENGTH ? `-${unknown}` : `--${unknown}`;
  throw new Exit(`Unknown option: ${flag}`, hint);
}

export function validatePathOption(value: string | undefined, flag: string, hint: string): void {
  if (value !== undefined && value.trim().length === 0) {
    throw new Exit(`--${flag} must not be empty`, hint);
  }
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

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
