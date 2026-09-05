import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixture: string;
let marker: string;
let configPath: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "hydra-cleanup-options-"));
  const runner = join(fixture, "runner");
  mkdirSync(join(runner, "_work"), { recursive: true });
  marker = join(runner, "_work", "checkout.txt");
  writeFileSync(marker, "preserve checkout");
  mkdirSync(join(fixture, ".hydra"));
  configPath = join(fixture, ".hydra", "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      profiles: { default: {} },
      runners: [
        {
          id: "test-runner",
          directory: runner,
          provider: "github",
          profile: "default",
          url: "https://github.com/test/repo",
        },
      ],
    }),
  );
});

afterEach(() => {
  rmSync(fixture, { force: true, recursive: true });
});

async function runCleanup(flag: string) {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../src/cli.ts"), "cleanup", "--work", "--yes", flag],
    { cwd: fixture, stderr: "pipe", stdin: "ignore", stdout: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: stdout + stderr };
}

describe("cleanup option safety", () => {
  test("rejects a misspelled dry-run flag before deleting workspaces", async () => {
    const before = readFileSync(configPath, "utf8");
    const result = await runCleanup("--dry-rum");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Unknown option: --dry-rum");
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  test("accepts the declared kebab-case dry-run alias", async () => {
    const before = readFileSync(configPath, "utf8");
    const result = await runCleanup("--dry-run");
    expect(result.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });
});
