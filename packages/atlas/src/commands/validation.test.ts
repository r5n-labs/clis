import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMMAND_NOT_FOUND_EXIT_CODE = 127;
let fixtureRoot: string;
let project: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "atlas-validation-"));
  project = join(fixtureRoot, "project");
  mkdirSync(join(project, ".atlas"), { recursive: true });
  writeFileSync(
    join(project, ".atlas", "config.json"),
    JSON.stringify({
      defaults: { exportFile: ".env.generated", profiles: ["app"] },
      profiles: { app: { vars: { APP: "default" } } },
    }),
  );
});

afterEach(() => {
  rmSync(fixtureRoot, { force: true, recursive: true });
});

async function runAtlas(argv: string[]) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "..", "cli.ts"), ...argv], {
    cwd: project,
    env: { ...process.env, HOME: join(fixtureRoot, "home"), NO_COLOR: "1" },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

describe("Atlas option validation", () => {
  test.each(
    [
      ["export", "--profiles", "prod", "--force"],
      ["export", "--ouput", "other.env", "--force"],
      ["init", "--globla", "--force"],
      ["profiles", "list", "--jsno"],
      ["profiles", "show", "app", "--jsno"],
    ].map((argv) => ({ argv })),
  )("rejects misspelled options in %j", async ({ argv }) => {
    const before = readFileSync(join(project, ".atlas", "config.json"), "utf8");
    const result = await runAtlas(argv);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("Unknown option:");
    expect(existsSync(join(project, ".env.generated"))).toBe(false);
    expect(readFileSync(join(project, ".atlas", "config.json"), "utf8")).toBe(before);
  });

  test.each(
    [
      ["export", "--out", ""],
      ["export", "--cwd", "   "],
      ["profiles", "list", "--cwd", ""],
      ["profiles", "show", "app", "--cwd", ""],
    ].map((argv) => ({ argv })),
  )("rejects blank paths in %j", async ({ argv }) => {
    const result = await runAtlas(argv);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("must not be empty");
    expect(existsSync(join(project, ".env.generated"))).toBe(false);
  });

  test.each([false, true])("rejects a directory output with a consistent error (force=%j)", async (force) => {
    const output = join(project, "output.env");
    mkdirSync(output);
    const result = await runAtlas(["export", "--out", output, ...(force ? ["--force"] : [])]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("Output path is not a regular file:");
    expect(result.stdout + result.stderr).not.toContain("Use --force");
  });

  test("reports missing working directories before attempting the child command", async () => {
    const cwd = join(project, "missing");
    const result = await runAtlas(["run", "--cwd", cwd, "--", process.execPath, "-e", ""]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain(`Working directory is not a directory: ${cwd}`);
  });

  test("reports a missing executable with the command-not-found exit code", async () => {
    const command = join(project, "missing-executable");
    const result = await runAtlas(["run", "--", command]);
    expect(result.exitCode).toBe(COMMAND_NOT_FOUND_EXIT_CODE);
    expect(result.stdout + result.stderr).toContain(`Command not found: ${command}`);
  });
});

describe("Atlas profile JSON errors", () => {
  test.each([["list"], ["show", "app"]].map((argv) => ({ argv })))(
    "preserves JSON errors for malformed config in %j",
    async ({ argv }) => {
      writeFileSync(join(project, ".atlas", "config.json"), "{invalid json");
      const result = await runAtlas(["profiles", ...argv, "--json"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toContain("Invalid JSON in Atlas config");
    },
  );

  test("reports unknown flags as JSON in JSON mode", async () => {
    const result = await runAtlas(["profiles", "list", "--json", "--bad"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({ error: "Unknown option: --bad" });
  });
});

describe("Atlas initialisation", () => {
  test("preserves an existing config unless force is explicit", async () => {
    const path = join(project, ".atlas", "config.json");
    const before = readFileSync(path, "utf8");
    const refused = await runAtlas(["init"]);
    expect(refused.exitCode).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(before);
    const forced = await runAtlas(["init", "--force"]);
    expect(forced.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8")).profiles).toEqual({});
  });

  test("force replaces a config symlink without changing the linked config", async () => {
    const path = join(project, ".atlas", "config.json");
    const target = join(fixtureRoot, "shared-config.json");
    const before = readFileSync(path, "utf8");
    writeFileSync(target, before);
    rmSync(path);
    symlinkSync(target, path);
    const result = await runAtlas(["init", "--force"]);
    expect(result.exitCode).toBe(0);
    expect(lstatSync(path).isSymbolicLink()).toBe(false);
    expect(readFileSync(target, "utf8")).toBe(before);
  });
});
