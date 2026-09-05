import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "sisyphus-roll-options-"));
});

afterEach(() => {
  rmSync(fixture, { force: true, recursive: true });
});

describe("roll option errors", () => {
  test("reports misspelled options as JSON before release preflight", async () => {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "../../src/cli.ts"), "roll", "--dry-rum", "--json"],
      { cwd: fixture, stderr: "pipe", stdin: "ignore", stdout: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.status).toBe("failed");
    expect(report.error.message).toBe("Unknown option: --dry-rum");
    expect(stderr).toContain("Unknown option: --dry-rum");
    expect(existsSync(join(fixture, ".sisyphus"))).toBe(false);
  });
});
