import { existsSync } from "node:fs";
import { readdir, readFile, readlink, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_CLEANUP_AUTO,
  DEFAULT_CLEANUP_INTERVAL_HOURS,
  DEFAULT_CLEANUP_OLDER_THAN_DAYS,
  DEFAULT_CLEANUP_TARGETS,
  SHARED_DIR,
} from "../constants";
import type { CleanupConfig, CleanupTarget, RunnerEntry } from "../types";
import { DIAG_DIR, discoverLogFiles, sortLogFilesNewestFirst } from "./log-files";
import type { LogFileType, RunnerLogFile } from "./types";

export const WORK_DIR = "_work";

const EXTERNALS_LINK = "externals";
const PID_FILE = ".pid";
const SHARED_GITHUB_SUBDIR = "github";
const EXTERNALS_VERSION_PATTERN = /github\/([^/]+)/;
const LOG_FILE_TYPES: LogFileType[] = ["runner", "worker"];
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3_600_000;
const DECIMAL_RADIX = 10;

export type CleanupOutcome = { freedBytes: number; removed: number; skipped: string[] };

export type CleanupReport = Partial<Record<CleanupTarget, CleanupOutcome>>;

export type CleanupRunOptions = {
  dryRun: boolean;
  entries: RunnerEntry[];
  now: number;
  olderThanDays: number;
  sharedDir?: string;
  targets: CleanupTarget[];
};

export function resolveCleanupConfig(cleanup?: Partial<CleanupConfig>): CleanupConfig {
  return {
    auto: cleanup?.auto ?? DEFAULT_CLEANUP_AUTO,
    intervalHours: cleanup?.intervalHours ?? DEFAULT_CLEANUP_INTERVAL_HOURS,
    lastRun: cleanup?.lastRun,
    olderThanDays: cleanup?.olderThanDays ?? DEFAULT_CLEANUP_OLDER_THAN_DAYS,
    targets: cleanup?.targets ?? DEFAULT_CLEANUP_TARGETS,
  };
}

export function computeCutoff(now: number, olderThanDays: number): number {
  return now - olderThanDays * HOURS_PER_DAY * MS_PER_HOUR;
}

export function isAutoCleanupDue(config: CleanupConfig, now: number): boolean {
  if (!config.lastRun) return true;

  const lastRun = Date.parse(config.lastRun);
  if (Number.isNaN(lastRun)) return true;

  return now - lastRun >= config.intervalHours * MS_PER_HOUR;
}

export function selectPrunableLogFiles(files: RunnerLogFile[], cutoff: number): RunnerLogFile[] {
  const sorted = sortLogFilesNewestFirst(files);
  const keep = new Set<string>();

  for (const type of LOG_FILE_TYPES) {
    const newest = sorted.find((file) => file.type === type);
    if (newest) keep.add(newest.path);
  }

  return sorted.filter((file) => !keep.has(file.path) && file.mtime.getTime() < cutoff);
}

export function newestVersion(versions: string[]): string | null {
  const sorted = [...versions].sort(compareVersionsDesc);
  return sorted[0] ?? null;
}

export function selectRemovableVersions(installed: string[], referenced: Iterable<string>): string[] {
  const newest = newestVersion(installed);
  const refs = new Set(referenced);
  return installed.filter((version) => version !== newest && !refs.has(version));
}

export function parseExternalsVersion(target: string): string | null {
  return target.match(EXTERNALS_VERSION_PATTERN)?.[1] ?? null;
}

export function totalFreedBytes(report: CleanupReport): number {
  return Object.values(report).reduce((sum, outcome) => sum + outcome.freedBytes, 0);
}

export async function isRunnerActive(runnerDir: string): Promise<boolean> {
  try {
    const content = await readFile(join(runnerDir, PID_FILE), "utf-8");
    const pid = Number.parseInt(content.trim(), DECIMAL_RADIX);
    if (Number.isNaN(pid)) return false;

    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function dirSize(path: string): Promise<number> {
  if (!existsSync(path)) return 0;

  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(entryPath);
      continue;
    }
    if (entry.isFile()) {
      const stats = await stat(entryPath);
      total += stats.size;
    }
  }

  return total;
}

export async function performCleanup(options: CleanupRunOptions): Promise<CleanupReport> {
  const cutoff = computeCutoff(options.now, options.olderThanDays);
  const report: CleanupReport = {};

  for (const target of options.targets) {
    switch (target) {
      case "logs":
        report.logs = await cleanupLogs(options.entries, cutoff, options.dryRun);
        break;
      case "work":
        report.work = await cleanupWork(options.entries, options.dryRun);
        break;
      case "shared":
        report.shared = await cleanupShared(options.entries, options.dryRun, options.sharedDir);
        break;
    }
  }

  return report;
}

async function cleanupLogs(entries: RunnerEntry[], cutoff: number, dryRun: boolean): Promise<CleanupOutcome> {
  const outcome: CleanupOutcome = { freedBytes: 0, removed: 0, skipped: [] };

  for (const entry of entries) {
    const files = await discoverLogFiles(join(entry.directory, DIAG_DIR));

    for (const file of selectPrunableLogFiles(files, cutoff)) {
      if (!dryRun) await rm(file.path, { force: true });
      outcome.removed++;
      outcome.freedBytes += file.size;
    }
  }

  return outcome;
}

async function cleanupWork(entries: RunnerEntry[], dryRun: boolean): Promise<CleanupOutcome> {
  const outcome: CleanupOutcome = { freedBytes: 0, removed: 0, skipped: [] };

  for (const entry of entries) {
    if (await isRunnerActive(entry.directory)) {
      outcome.skipped.push(entry.id);
      continue;
    }

    const workDir = join(entry.directory, WORK_DIR);
    if (!existsSync(workDir)) continue;

    const items = await readdir(workDir);
    if (items.length === 0) continue;

    outcome.freedBytes += await dirSize(workDir);
    outcome.removed += items.length;

    if (dryRun) continue;
    for (const item of items) {
      await rm(join(workDir, item), { force: true, recursive: true });
    }
  }

  return outcome;
}

async function cleanupShared(entries: RunnerEntry[], dryRun: boolean, sharedDir?: string): Promise<CleanupOutcome> {
  const outcome: CleanupOutcome = { freedBytes: 0, removed: 0, skipped: [] };
  const githubDir = sharedDir ?? join(SHARED_DIR, SHARED_GITHUB_SUBDIR);
  if (!existsSync(githubDir)) return outcome;

  const dirEntries = await readdir(githubDir, { withFileTypes: true });
  const installed = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const referenced = await collectReferencedVersions(entries);

  for (const version of selectRemovableVersions(installed, referenced)) {
    const versionDir = join(githubDir, version);
    outcome.freedBytes += await dirSize(versionDir);
    outcome.removed++;
    if (!dryRun) await rm(versionDir, { force: true, recursive: true });
  }

  return outcome;
}

async function collectReferencedVersions(entries: RunnerEntry[]): Promise<string[]> {
  const referenced: string[] = [];

  for (const entry of entries) {
    try {
      const target = await readlink(join(entry.directory, EXTERNALS_LINK));
      const version = parseExternalsVersion(target);
      if (version) referenced.push(version);
    } catch {}
  }

  return referenced;
}

function compareVersionsDesc(a: string, b: string): number {
  const aSegments = a.split(".").map((segment) => Number.parseInt(segment, DECIMAL_RADIX));
  const bSegments = b.split(".").map((segment) => Number.parseInt(segment, DECIMAL_RADIX));
  const length = Math.max(aSegments.length, bSegments.length);

  for (let i = 0; i < length; i++) {
    const aValue = aSegments[i] ?? 0;
    const bValue = bSegments[i] ?? 0;
    const aNumber = Number.isNaN(aValue) ? 0 : aValue;
    const bNumber = Number.isNaN(bValue) ? 0 : bValue;
    if (aNumber !== bNumber) return bNumber - aNumber;
  }

  return 0;
}
