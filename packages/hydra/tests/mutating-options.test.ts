import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixture: string;
let configPath: string;
let workspaceMarker: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "hydra-mutating-options-"));
  mkdirSync(join(fixture, ".hydra"));
  configPath = join(fixture, ".hydra", "config.json");
  mkdirSync(join(fixture, "runner-1", "_work"), { recursive: true });
  workspaceMarker = join(fixture, "runner-1", "_work", "checkout.txt");
  writeFileSync(workspaceMarker, "preserve checkout");
});

afterEach(() => {
  rmSync(fixture, { force: true, recursive: true });
});

describe("Hydra mutating command option validation", () => {
  test.each([
    { argv: ["create", "--dry-run"], exitCode: 1, existingRunner: true, output: "Unknown option: --dry-run" },
    { argv: ["remove", "--dry-run"], exitCode: 1, existingRunner: false, output: "Unknown option: --dry-run" },
    { argv: ["start", "--dry-rum"], exitCode: 1, existingRunner: false, output: "Unknown option: --dry-rum" },
    { argv: ["stop", "--dry-rum"], exitCode: 1, existingRunner: false, output: "Unknown option: --dry-rum" },
    { argv: ["update", "--dry-run"], exitCode: 1, existingRunner: false, output: "Unknown option: --dry-run" },
    {
      argv: ["init", "https://github.com/owner/repo", "--force", "--gloabl"],
      exitCode: 1,
      existingRunner: false,
      output: "Unknown option: --gloabl",
    },
    {
      argv: ["profile", "default", "other", "--dry-run"],
      exitCode: 1,
      existingRunner: false,
      output: "Unknown option: --dry-run",
    },
    {
      argv: ["profile", "remove", "other", "--froce"],
      exitCode: 1,
      existingRunner: false,
      output: "Unknown option: --froce",
    },
    {
      argv: ["cleanup", "--work", "--yes", "--dry-rum"],
      exitCode: 1,
      existingRunner: true,
      output: "Unknown option: --dry-rum",
    },
    {
      argv: ["cleanup", "--work", "--yes", "--dry-run"],
      exitCode: 0,
      existingRunner: true,
      output: "would remove 1 item(s)",
    },
  ])("leaves runner state untouched for %j", async ({ argv, exitCode: expectedExitCode, existingRunner, output }) => {
    const profile = {
      directory: join(fixture, ".hydra", "runners"),
      name: "runner",
      numberOfMachines: 1,
      os: "osx",
      provider: "github",
      url: "https://github.com/owner/repo",
    };
    const runners = existingRunner
      ? [
          {
            id: "runner-1",
            directory: join(fixture, "runner-1"),
            profile: "default",
            provider: "github",
            url: profile.url,
          },
        ]
      : [];
    const original = JSON.stringify({
      defaultProfile: "default",
      profiles: { default: profile, other: profile },
      runners,
    });
    writeFileSync(configPath, original);

    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...argv], {
      cwd: fixture,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(expectedExitCode);
    expect(stdout + stderr).toContain(output);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(existsSync(workspaceMarker)).toBe(true);
    expect(existsSync(profile.directory)).toBe(false);
    expect(existsSync(join(fixture, ".hydra", "shared"))).toBe(false);
  });
});
