import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LogFileType, RunnerLogFile } from "./types";

export const DIAG_DIR = "_diag";

const LOG_FILE_PATTERNS: Record<LogFileType, RegExp> = { runner: /^Runner_.+\.log$/, worker: /^Worker_.+\.log$/ };

const BYTES_PER_UNIT = 1024;
const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;
const SIZE_DECIMALS = 1;

export function classifyLogFile(name: string): LogFileType | null {
  if (LOG_FILE_PATTERNS.worker.test(name)) return "worker";
  if (LOG_FILE_PATTERNS.runner.test(name)) return "runner";
  return null;
}

export function sortLogFilesNewestFirst(files: RunnerLogFile[]): RunnerLogFile[] {
  return [...files].sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export async function discoverLogFiles(diagDir: string): Promise<RunnerLogFile[]> {
  if (!existsSync(diagDir)) return [];

  const entries = await readdir(diagDir, { withFileTypes: true });
  const files: RunnerLogFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const type = classifyLogFile(entry.name);
    if (!type) continue;

    const path = join(diagDir, entry.name);
    const stats = await stat(path);
    files.push({ mtime: stats.mtime, name: entry.name, path, size: stats.size, type });
  }

  return sortLogFilesNewestFirst(files);
}

export function pickLogFile(
  files: RunnerLogFile[],
  preferred: LogFileType,
): { file: RunnerLogFile; fallback: boolean } | null {
  const match = files.find((file) => file.type === preferred);
  if (match) return { fallback: false, file: match };

  const newest = files[0];
  return newest ? { fallback: true, file: newest } : null;
}

export function tailLines(content: string, count: number): string {
  if (count <= 0) return "";

  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (trimmed === "") return "";

  return trimmed.split("\n").slice(-count).join("\n");
}

export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;

  while (value >= BYTES_PER_UNIT && unit < SIZE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit++;
  }

  const formatted = unit === 0 ? String(value) : value.toFixed(SIZE_DECIMALS);
  return `${formatted} ${SIZE_UNITS[unit] ?? "B"}`;
}
