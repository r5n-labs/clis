import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyLogFile,
  discoverLogFiles,
  formatFileSize,
  pickLogFile,
  sortLogFilesNewestFirst,
  tailLines,
} from "../src/providers/log-files";
import type { RunnerLogFile } from "../src/providers/types";

const makeLogFile = (overrides: Partial<RunnerLogFile>): RunnerLogFile => ({
  mtime: new Date("2026-01-01T00:00:00Z"),
  name: "Worker_20260101-000000-utc.log",
  path: "/tmp/Worker_20260101-000000-utc.log",
  size: 0,
  type: "worker",
  ...overrides,
});

describe("classifyLogFile", () => {
  test("classifies Worker logs", () => {
    expect(classifyLogFile("Worker_20260115-103000-utc.log")).toBe("worker");
  });

  test("classifies Runner logs", () => {
    expect(classifyLogFile("Runner_20260115-103000-utc.log")).toBe("runner");
  });

  test("returns null for unrelated files", () => {
    expect(classifyLogFile("something.txt")).toBeNull();
    expect(classifyLogFile("Worker_.log")).toBeNull();
    expect(classifyLogFile("Worker_20260115.log.bak")).toBeNull();
    expect(classifyLogFile(".DS_Store")).toBeNull();
  });
});

describe("sortLogFilesNewestFirst", () => {
  test("sorts by mtime descending", () => {
    const oldFile = makeLogFile({ mtime: new Date("2026-01-01T00:00:00Z"), name: "old" });
    const newFile = makeLogFile({ mtime: new Date("2026-03-01T00:00:00Z"), name: "new" });
    const midFile = makeLogFile({ mtime: new Date("2026-02-01T00:00:00Z"), name: "mid" });

    const sorted = sortLogFilesNewestFirst([oldFile, newFile, midFile]);

    expect(sorted.map((f) => f.name)).toEqual(["new", "mid", "old"]);
  });

  test("does not mutate the input array", () => {
    const files = [
      makeLogFile({ mtime: new Date("2026-01-01T00:00:00Z"), name: "a" }),
      makeLogFile({ mtime: new Date("2026-02-01T00:00:00Z"), name: "b" }),
    ];

    sortLogFilesNewestFirst(files);

    expect(files.map((f) => f.name)).toEqual(["a", "b"]);
  });
});

describe("pickLogFile", () => {
  test("picks the newest file of the preferred type", () => {
    const files = [
      makeLogFile({ mtime: new Date("2026-03-01T00:00:00Z"), name: "runner-new", type: "runner" }),
      makeLogFile({ mtime: new Date("2026-02-01T00:00:00Z"), name: "worker-new", type: "worker" }),
      makeLogFile({ mtime: new Date("2026-01-01T00:00:00Z"), name: "worker-old", type: "worker" }),
    ];

    const picked = pickLogFile(files, "worker");

    expect(picked?.file.name).toBe("worker-new");
    expect(picked?.fallback).toBe(false);
  });

  test("falls back to the newest file when preferred type is missing", () => {
    const files = [
      makeLogFile({ mtime: new Date("2026-03-01T00:00:00Z"), name: "runner-new", type: "runner" }),
      makeLogFile({ mtime: new Date("2026-01-01T00:00:00Z"), name: "runner-old", type: "runner" }),
    ];

    const picked = pickLogFile(files, "worker");

    expect(picked?.file.name).toBe("runner-new");
    expect(picked?.fallback).toBe(true);
  });

  test("returns null when there are no files", () => {
    expect(pickLogFile([], "worker")).toBeNull();
  });
});

describe("tailLines", () => {
  test("returns the last N lines", () => {
    expect(tailLines("a\nb\nc\nd\n", 2)).toBe("c\nd");
  });

  test("returns everything when N exceeds line count", () => {
    expect(tailLines("a\nb\n", 10)).toBe("a\nb");
  });

  test("handles content without trailing newline", () => {
    expect(tailLines("a\nb\nc", 2)).toBe("b\nc");
  });

  test("returns empty string for empty content", () => {
    expect(tailLines("", 5)).toBe("");
    expect(tailLines("\n", 5)).toBe("");
  });

  test("returns empty string for non-positive counts", () => {
    expect(tailLines("a\nb", 0)).toBe("");
    expect(tailLines("a\nb", -1)).toBe("");
  });
});

describe("formatFileSize", () => {
  test("formats bytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  test("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  test("formats megabytes", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("discoverLogFiles", () => {
  let diagDir: string;

  beforeEach(async () => {
    diagDir = mkdtempSync(join(tmpdir(), "hydra-logs-"));
    await mkdir(diagDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(diagDir, { force: true, recursive: true });
  });

  const writeLog = async (name: string, mtime: Date, content = "log") => {
    const path = join(diagDir, name);
    await writeFile(path, content);
    await utimes(path, mtime, mtime);
  };

  test("returns empty array for missing directory", async () => {
    expect(await discoverLogFiles(join(diagDir, "does-not-exist"))).toEqual([]);
  });

  test("returns empty array for empty directory", async () => {
    expect(await discoverLogFiles(diagDir)).toEqual([]);
  });

  test("discovers and classifies log files sorted newest-first", async () => {
    await writeLog("Worker_20260101-000000-utc.log", new Date("2026-01-01T00:00:00Z"));
    await writeLog("Worker_20260301-000000-utc.log", new Date("2026-03-01T00:00:00Z"));
    await writeLog("Runner_20260201-000000-utc.log", new Date("2026-02-01T00:00:00Z"));

    const files = await discoverLogFiles(diagDir);

    expect(files.map((f) => f.name)).toEqual([
      "Worker_20260301-000000-utc.log",
      "Runner_20260201-000000-utc.log",
      "Worker_20260101-000000-utc.log",
    ]);
    expect(files.map((f) => f.type)).toEqual(["worker", "runner", "worker"]);
  });

  test("ignores unrelated files and directories", async () => {
    await writeLog("Worker_20260101-000000-utc.log", new Date("2026-01-01T00:00:00Z"));
    await writeFile(join(diagDir, "notes.txt"), "not a log");
    await mkdir(join(diagDir, "Worker_20260102-000000-utc.log"), { recursive: true });

    const files = await discoverLogFiles(diagDir);

    expect(files.map((f) => f.name)).toEqual(["Worker_20260101-000000-utc.log"]);
  });

  test("records file size and mtime", async () => {
    const mtime = new Date("2026-02-01T00:00:00Z");
    await writeLog("Runner_20260201-000000-utc.log", mtime, "12345");

    const files = await discoverLogFiles(diagDir);

    expect(files).toHaveLength(1);
    expect(files[0]?.size).toBe(5);
    expect(files[0]?.mtime.getTime()).toBe(mtime.getTime());
  });
});
