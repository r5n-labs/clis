import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixture: string;
let configPath: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "hydra-mutating-options-"));
  mkdirSync(join(fixture, ".hydra"));
  configPath = join(fixture, ".hydra", "config.json");
});

afterEach(() => {
  rmSync(fixture, { force: true, recursive: true });
});

describe("Hydra mutating command option validation", () => {
  test.each([
    { argv: ["create", "--dry-run"], existingRunner: true, flag: "--dry-run" },
    { argv: ["remove", "--dry-run"], existingRunner: false, flag: "--dry-run" },
    { argv: ["start", "--dry-rum"], existingRunner: false, flag: "--dry-rum" },
    { argv: ["stop", "--dry-rum"], existingRunner: false, flag: "--dry-rum" },
    { argv: ["update", "--dry-run"], existingRunner: false, flag: "--dry-run" },
    { argv: ["init", "https://github.com/owner/repo", "--force", "--gloabl"], existingRunner: false, flag: "--gloabl" },
    { argv: ["profile", "default", "other", "--dry-run"], existingRunner: false, flag: "--dry-run" },
    { argv: ["profile", "remove", "other", "--froce"], existingRunner: false, flag: "--froce" },
  ])("rejects unknown options before performing %j", async ({ argv, existingRunner, flag }) => {
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
            directory: join(profile.directory, "runner-1"),
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
    expect(exitCode).toBe(1);
    expect(stdout + stderr).toContain(`Unknown option: ${flag}`);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(existsSync(profile.directory)).toBe(false);
    expect(existsSync(join(fixture, ".hydra", "shared"))).toBe(false);
  });
});
