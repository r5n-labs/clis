import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isAutoCleanupDue,
  newestVersion,
  performCleanup,
  resolveCleanupConfig,
  selectPrunableLogFiles,
  selectRemovableVersions,
  totalFreedBytes,
} from "../src/providers/cleanup";
import { parseExternalsVersion } from "../src/providers/runner-version";
import type { RunnerLogFile } from "../src/providers/types";
import type { RunnerEntry } from "../src/types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-07-01T00:00:00Z");
const SYNTHETIC_PID = 123456789;
const RETENTION_DAYS = 7;
const RETAINED_LOG_AGE_DAYS = 3;
const EXPIRED_LOG_AGE_DAYS = 8;

const makeLogFile = (overrides: Partial<RunnerLogFile>): RunnerLogFile => ({
  mtime: new Date("2026-01-01T00:00:00Z"),
  name: "Worker_20260101-000000-utc.log",
  path: "/tmp/Worker_20260101-000000-utc.log",
  size: 0,
  type: "worker",
  ...overrides,
});

const makeEntry = (id: string, directory: string): RunnerEntry => ({
  createdAt: "2026-01-01T00:00:00Z",
  directory,
  id,
  name: id,
  profile: "default",
  provider: "github",
  url: "https://github.com/owner/repo",
});

describe("resolveCleanupConfig", () => {
  test("returns defaults for an absent section", () => {
    expect(resolveCleanupConfig(undefined)).toEqual({
      auto: false,
      intervalHours: 24,
      lastRun: undefined,
      olderThanDays: 7,
      targets: ["logs", "shared"],
    });
  });

  test("merges user-set fields over defaults", () => {
    const resolved = resolveCleanupConfig({ auto: true, olderThanDays: 30 });

    expect(resolved.auto).toBe(true);
    expect(resolved.olderThanDays).toBe(30);
    expect(resolved.intervalHours).toBe(24);
    expect(resolved.targets).toEqual(["logs", "shared"]);
  });

  test("preserves lastRun and explicit targets", () => {
    const resolved = resolveCleanupConfig({ lastRun: "2026-06-01T00:00:00Z", targets: ["work"] });

    expect(resolved.lastRun).toBe("2026-06-01T00:00:00Z");
    expect(resolved.targets).toEqual(["work"]);
  });
});

describe("isAutoCleanupDue", () => {
  const base = { auto: true, intervalHours: 24, olderThanDays: 7, targets: [] };

  test("due when lastRun is missing", () => {
    expect(isAutoCleanupDue({ ...base }, NOW)).toBe(true);
  });

  test("not due when lastRun is within the interval", () => {
    expect(isAutoCleanupDue({ ...base, lastRun: new Date(NOW - HOUR_MS).toISOString() }, NOW)).toBe(false);
  });

  test("due when lastRun is at or past the interval", () => {
    expect(isAutoCleanupDue({ ...base, lastRun: new Date(NOW - 24 * HOUR_MS).toISOString() }, NOW)).toBe(true);
  });

  test("due when lastRun is unparseable", () => {
    expect(isAutoCleanupDue({ ...base, lastRun: "not-a-date" }, NOW)).toBe(true);
  });
});

describe("selectPrunableLogFiles", () => {
  const cutoff = NOW - 7 * DAY_MS;

  test("selects only files older than the cutoff", () => {
    const oldWorker = makeLogFile({ mtime: new Date(NOW - 10 * DAY_MS), path: "/w-old" });
    const newWorker = makeLogFile({ mtime: new Date(NOW - DAY_MS), path: "/w-new" });
    const midWorker = makeLogFile({ mtime: new Date(NOW - 8 * DAY_MS), path: "/w-mid" });

    const prunable = selectPrunableLogFiles([oldWorker, newWorker, midWorker], cutoff);

    expect(prunable.map((f) => f.path).sort()).toEqual(["/w-mid", "/w-old"]);
  });

  test("keeps the newest runner and newest worker log regardless of age", () => {
    const files = [
      makeLogFile({ mtime: new Date(NOW - 30 * DAY_MS), path: "/w-1" }),
      makeLogFile({ mtime: new Date(NOW - 20 * DAY_MS), path: "/w-2" }),
      makeLogFile({ mtime: new Date(NOW - 40 * DAY_MS), path: "/r-1", type: "runner" }),
      makeLogFile({ mtime: new Date(NOW - 25 * DAY_MS), path: "/r-2", type: "runner" }),
    ];

    const prunable = selectPrunableLogFiles(files, cutoff);

    expect(prunable.map((f) => f.path).sort()).toEqual(["/r-1", "/w-1"]);
  });

  test("never selects anything from a single-file-per-type set", () => {
    const files = [
      makeLogFile({ mtime: new Date(NOW - 100 * DAY_MS), path: "/w" }),
      makeLogFile({ mtime: new Date(NOW - 100 * DAY_MS), path: "/r", type: "runner" }),
    ];

    expect(selectPrunableLogFiles(files, cutoff)).toEqual([]);
  });

  test("returns empty for no files", () => {
    expect(selectPrunableLogFiles([], cutoff)).toEqual([]);
  });
});

describe("newestVersion", () => {
  test("compares versions numerically per segment", () => {
    expect(newestVersion(["2.9.0", "2.10.1", "2.10.0"])).toBe("2.10.1");
  });

  test("returns null for empty input", () => {
    expect(newestVersion([])).toBeNull();
  });
});

describe("selectRemovableVersions", () => {
  const installed = ["2.316.0", "2.317.0", "2.318.0"];

  test("removes orphans, keeps referenced and newest", () => {
    expect(selectRemovableVersions(installed, ["2.317.0"])).toEqual(["2.316.0"]);
  });

  test("keeps the newest version even when unreferenced", () => {
    expect(selectRemovableVersions(installed, ["2.316.0"])).toEqual(["2.317.0"]);
  });

  test("ignores references to versions that are not installed", () => {
    expect(selectRemovableVersions(installed, ["9.9.9"])).toEqual(["2.316.0", "2.317.0"]);
  });

  test("returns empty when nothing is installed", () => {
    expect(selectRemovableVersions([], ["2.317.0"])).toEqual([]);
  });
});

describe("parseExternalsVersion", () => {
  test("extracts the version from an externals target", () => {
    expect(parseExternalsVersion("/repo/.hydra/shared/github/2.317.0/externals")).toBe("2.317.0");
  });

  test("returns null for unrelated paths", () => {
    expect(parseExternalsVersion("/somewhere/else")).toBeNull();
  });
});

describe("totalFreedBytes", () => {
  test("sums freed bytes across targets", () => {
    const report = {
      logs: { freedBytes: 10, removed: 1, skipped: [] },
      shared: { freedBytes: 32, removed: 1, skipped: [] },
    };

    expect(totalFreedBytes(report)).toBe(42);
    expect(totalFreedBytes({})).toBe(0);
  });
});

describe("performCleanup", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "hydra-cleanup-"));
    await mkdir(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  const writeAged = async (path: string, ageMs: number, content = "log") => {
    await writeFile(path, content);
    const mtime = new Date(NOW - ageMs);
    await utimes(path, mtime, mtime);
  };

  const makeRunner = async (id: string) => {
    const dir = join(root, "runners", id);
    await mkdir(join(dir, "_diag"), { recursive: true });
    return { dir, entry: makeEntry(id, dir) };
  };

  test("logs: prunes old files but keeps the newest per type, handles empty and missing dirs", async () => {
    const { dir, entry } = await makeRunner("mac-1");
    const { entry: emptyEntry } = await makeRunner("mac-2");
    const missingEntry = makeEntry("mac-3", join(root, "runners", "mac-3"));

    await writeAged(join(dir, "_diag", "Worker_20260501-000000-utc.log"), 30 * DAY_MS, "old-worker");
    await writeAged(join(dir, "_diag", "Worker_20260601-000000-utc.log"), 20 * DAY_MS, "kept-worker");
    await writeAged(join(dir, "_diag", "Runner_20260401-000000-utc.log"), 40 * DAY_MS, "kept-runner");

    const report = await performCleanup({
      dryRun: false,
      entries: [entry, emptyEntry, missingEntry],
      now: NOW,
      olderThanDays: 7,
      targets: ["logs"],
    });

    expect(report.logs?.removed).toBe(1);
    expect(report.logs?.freedBytes).toBe("old-worker".length);
    const remaining = await readdir(join(dir, "_diag"));
    expect(remaining.sort()).toEqual(["Runner_20260401-000000-utc.log", "Worker_20260601-000000-utc.log"]);
  });

  test("logs: measures olderThanDays in whole days", async () => {
    const { dir, entry } = await makeRunner("mac-1");
    await writeAged(join(dir, "_diag", "Worker_20260630-000000-utc.log"), DAY_MS);
    await writeAged(join(dir, "_diag", "Worker_20260628-000000-utc.log"), RETAINED_LOG_AGE_DAYS * DAY_MS);
    await writeAged(join(dir, "_diag", "Worker_20260623-000000-utc.log"), EXPIRED_LOG_AGE_DAYS * DAY_MS);

    const report = await performCleanup({
      dryRun: false,
      entries: [entry],
      now: NOW,
      olderThanDays: RETENTION_DAYS,
      targets: ["logs"],
    });

    expect(report.logs?.removed).toBe(1);
    expect((await readdir(join(dir, "_diag"))).sort()).toEqual([
      "Worker_20260628-000000-utc.log",
      "Worker_20260630-000000-utc.log",
    ]);
  });

  test("logs: dry run deletes nothing", async () => {
    const { dir, entry } = await makeRunner("mac-1");
    await writeAged(join(dir, "_diag", "Worker_20260501-000000-utc.log"), 30 * DAY_MS);
    await writeAged(join(dir, "_diag", "Worker_20260601-000000-utc.log"), 20 * DAY_MS);

    const report = await performCleanup({
      dryRun: true,
      entries: [entry],
      now: NOW,
      olderThanDays: 7,
      targets: ["logs"],
    });

    expect(report.logs?.removed).toBe(1);
    expect((await readdir(join(dir, "_diag"))).length).toBe(2);
  });

  test("work: clears _work contents of stopped runners and skips running ones", async () => {
    const { dir: stoppedDir, entry: stoppedEntry } = await makeRunner("mac-1");
    const { dir: runningDir, entry: runningEntry } = await makeRunner("mac-2");

    await mkdir(join(stoppedDir, "_work", "repo"), { recursive: true });
    await writeFile(join(stoppedDir, "_work", "repo", "checkout.txt"), "12345");
    await mkdir(join(runningDir, "_work", "repo"), { recursive: true });
    await writeFile(join(runningDir, "_work", "repo", "checkout.txt"), "12345");
    await writeFile(join(runningDir, ".pid"), String(process.pid));

    const report = await performCleanup({
      dryRun: false,
      entries: [stoppedEntry, runningEntry],
      now: NOW,
      olderThanDays: 7,
      targets: ["work"],
    });

    expect(report.work?.removed).toBe(1);
    expect(report.work?.freedBytes).toBe(5);
    expect(report.work?.skipped).toEqual(["mac-2"]);
    expect(await readdir(join(stoppedDir, "_work"))).toEqual([]);
    expect(await readdir(join(runningDir, "_work"))).toEqual(["repo"]);
  });

  test.each(["EPERM", "ESRCH", "EIO"])(
    "work: handles %s without treating uncertainty as a stopped runner",
    async (code) => {
      const { dir, entry } = await makeRunner("mac-1");
      const checkout = join(dir, "_work", "repo", "checkout.txt");
      await mkdir(join(dir, "_work", "repo"), { recursive: true });
      await writeFile(checkout, "retained checkout");
      await writeFile(join(dir, ".pid"), String(SYNTHETIC_PID));
      const originalKill = process.kill;
      process.kill = (pid, signal) => {
        if (pid !== SYNTHETIC_PID || signal !== 0) return originalKill(pid, signal);
        throw Object.assign(new Error(code), { code });
      };

      try {
        const operation = performCleanup({
          dryRun: false,
          entries: [entry],
          now: NOW,
          olderThanDays: 7,
          targets: ["work"],
        });
        if (code === "EIO") {
          await expect(operation).rejects.toThrow(code);
        } else {
          const report = await operation;
          expect(report.work?.removed).toBe(code === "ESRCH" ? 1 : 0);
          expect(report.work?.skipped).toEqual(code === "EPERM" ? [entry.id] : []);
        }
        if (code === "ESRCH") expect(existsSync(checkout)).toBe(false);
        else expect(await readFile(checkout, "utf8")).toBe("retained checkout");
      } finally {
        process.kill = originalKill;
      }
    },
  );

  test.each(["", "0", "1", "-1", "2junk", "2.5", "9007199254740992"])(
    "work: never probes malformed PID %j",
    async (pid) => {
      const { dir, entry } = await makeRunner("mac-1");
      await writeFile(join(dir, ".pid"), pid);
      const originalKill = process.kill;
      const probes: number[] = [];
      process.kill = (candidate) => {
        probes.push(candidate);
        return true;
      };
      try {
        await performCleanup({ dryRun: true, entries: [entry], now: NOW, olderThanDays: 7, targets: ["work"] });
        expect(probes).toEqual([]);
      } finally {
        process.kill = originalKill;
      }
    },
  );

  test.each(["", "github/fleet", "notgithub/fleet"])(
    "shared: preserves referenced and newest versions beneath %j",
    async (ancestor) => {
      const sharedDir = join(root, ancestor, "shared", "github");
      for (const version of ["2.316.0", "2.317.0", "2.318.0"]) {
        await mkdir(join(sharedDir, version), { recursive: true });
        await writeFile(join(sharedDir, version, "runner.bin"), "bin");
      }

      const { dir: refDir, entry: refEntry } = await makeRunner("mac-1");
      await symlink(join(sharedDir, "2.317.0", "externals"), join(refDir, "externals"));

      const { dir: danglingDir, entry: danglingEntry } = await makeRunner("mac-2");
      await symlink(join(root, "shared", "github", "9.9.9", "externals"), join(danglingDir, "externals"));

      const { entry: noLinkEntry } = await makeRunner("mac-3");

      const report = await performCleanup({
        dryRun: false,
        entries: [refEntry, danglingEntry, noLinkEntry],
        now: NOW,
        olderThanDays: 7,
        sharedDir,
        targets: ["shared"],
      });

      expect(report.shared?.removed).toBe(1);
      expect(report.shared?.freedBytes).toBe(3);
      expect(existsSync(join(sharedDir, "2.316.0"))).toBe(false);
      expect(existsSync(join(sharedDir, "2.317.0"))).toBe(true);
      expect(existsSync(join(sharedDir, "2.318.0"))).toBe(true);
    },
  );

  test("shared: missing shared directory is a no-op", async () => {
    const report = await performCleanup({
      dryRun: false,
      entries: [],
      now: NOW,
      olderThanDays: 7,
      sharedDir: join(root, "does-not-exist"),
      targets: ["shared"],
    });

    expect(report.shared).toEqual({ freedBytes: 0, removed: 0, skipped: [] });
  });
});
