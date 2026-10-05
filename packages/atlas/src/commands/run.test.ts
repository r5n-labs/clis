import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type ConfigManager, Exit } from "@r5n/cli-core";
import { version } from "../../package.json";
import type { AtlasConfig } from "../types";
import { RunCommand } from "./run";

const ATLAS_ROOT = join(import.meta.dir, "../..");
const CHILD_KEEPALIVE_INTERVAL_MS = 1_000;
const FILE_POLL_INTERVAL_MS = 10;
const SIGNAL_EXIT_CODE = 42;
const TEST_TIMEOUT_MS = 5_000;

const originalHome = process.env.HOME;
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "atlas-run-"));
  process.env.HOME = join(tmpRoot, "home");
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmpRoot, { force: true, recursive: true });
});

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

class FakeConfigManager {
  exists(): boolean {
    return false;
  }
  get<K extends keyof AtlasConfig>(_key: K): AtlasConfig[K] {
    throw new Error("unused");
  }
  getAll(): AtlasConfig {
    throw new Error("unused");
  }
  set<K extends keyof AtlasConfig>(_key: K, _value: AtlasConfig[K]): void {}
  save(_config?: AtlasConfig): void {}
}

type RunCtx = Parameters<RunCommand["execute"]>[0];

function ctx(args: { command: string[]; cwd?: string; extraArgs?: Record<string, unknown>; profile?: string }): RunCtx {
  return {
    args: { cwd: args.cwd, profile: args.profile, ...args.extraArgs },
    cli: {} as never,
    config: new FakeConfigManager() as unknown as ConfigManager<AtlasConfig>,
    interactive: false,
    positionals: { command: args.command },
  } as unknown as RunCtx;
}

function isolatedEnv(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return { ...process.env, HOME: join(tmpRoot, "home"), ...overrides };
}

function spawnAtlas(args: string[]) {
  return Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    cwd: ATLAS_ROOT,
    env: isolatedEnv(),
    stderr: "ignore",
    stdin: "ignore",
    stdout: "ignore",
  });
}

async function runAtlas(
  args: string[],
  envOverrides: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    cwd: ATLAS_ROOT,
    env: isolatedEnv(envOverrides),
    stderr: "ignore",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  return { exitCode, stdout };
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPid(path: string): Promise<number> {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await Bun.sleep(FILE_POLL_INTERVAL_MS);
  }
  const pid = Number(readFileSync(path, "utf8"));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid child PID in ${path}`);
  return pid;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Timed out waiting for process exit")), TEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

describe("RunCommand", () => {
  test("normalizes a relative requested cwd before spawning the command", async () => {
    const project = join(tmpRoot, "repo");
    const output = join(tmpRoot, "pwd.txt");
    mkdirSync(project, { recursive: true });
    writeJson(join(project, ".atlas", "config.json"), { profiles: {} });
    const requestedCwd = relative(process.cwd(), project);
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");

    await new RunCommand().execute(
      ctx({
        command: [process.execPath, "-e", `await Bun.write(${JSON.stringify(output)}, process.cwd())`],
        cwd: requestedCwd,
      }),
    );

    expect(realpathSync(readFileSync(output, "utf8").trim())).toBe(realpathSync(project));
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
  });

  test.each([
    { expected: "default", selection: [] },
    { expected: "selected", selection: ["--profile", "selected"] },
  ])("delivers inherited and composed profile values to the CLI child: $expected", async ({ expected, selection }) => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { profiles: ["default"] },
      profiles: {
        default: { vars: { ATLAS_TEST_DEFAULT: "applied", ATLAS_TEST_OVERLAP: "default" } },
        selected: { vars: { ATLAS_TEST_OVERLAP: "selected" } },
      },
    });
    const childScript =
      "console.log(JSON.stringify([process.env.ATLAS_TEST_KEEP, process.env.ATLAS_TEST_OVERLAP, process.env.ATLAS_TEST_DEFAULT]))";
    const { exitCode, stdout } = await runAtlas(
      ["run", "--cwd", project, ...selection, "--", process.execPath, "-e", childScript],
      { ATLAS_TEST_KEEP: "inherited", ATLAS_TEST_OVERLAP: "process" },
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(["inherited", expected, "applied"]);
  });

  test.each(["", "   ", ",", " , , "])("rejects an explicitly empty profile value %j", async (profile) => {
    const project = join(tmpRoot, "repo");
    const output = join(tmpRoot, "spawned.txt");
    mkdirSync(join(project, ".atlas"), { recursive: true });
    writeFileSync(join(project, ".atlas", "config.json"), "{", "utf8");

    const execution = new RunCommand().execute(
      ctx({
        command: [process.execPath, "-e", `await Bun.write(${JSON.stringify(output)}, "spawned")`],
        cwd: project,
        profile,
      }),
    );

    await expect(execution).rejects.toThrow("--profile must include at least one profile");
    expect(existsSync(output)).toBe(false);
  });

  test.each(["", "   "])("rejects an explicitly blank cwd %j before falling back or spawning", async (cwd) => {
    const output = join(tmpRoot, "spawned.txt");
    const execution = new RunCommand().execute(
      ctx({ command: [process.execPath, "-e", `await Bun.write(${JSON.stringify(output)}, "spawned")`], cwd }),
    );

    await expect(execution).rejects.toThrow("--cwd must not be empty");
    expect(existsSync(output)).toBe(false);
  });

  test("rejects unknown flags before -- with a passthrough hint instead of spawning", async () => {
    const output = join(tmpRoot, "spawned.txt");
    const execution = new RunCommand().execute(
      ctx({
        command: [process.execPath, "-e", `await Bun.write(${JSON.stringify(output)}, "spawned")`],
        extraArgs: { watch: true },
      }),
    );

    const error = await execution.then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Exit);
    expect((error as Exit).message).toBe("Unknown option: --watch");
    expect((error as Exit).hint).toContain("after --");
    expect(existsSync(output)).toBe(false);
  });

  test("returns nonzero from the CLI for unknown flags placed before --", async () => {
    const child = spawnAtlas(["run", "--watch", "--", process.execPath, "-e", ""]);

    expect(await child.exited).toBe(1);
  });

  test.each([
    ["version", "Unknown option: --version"],
    ["v", "Unknown option: -v"],
    ["interactive", "Unknown option: --interactive"],
    ["i", "Unknown option: -i"],
  ])("rejects the global %s flag consumed from the child argv instead of dropping it", async (flag, message) => {
    const output = join(tmpRoot, "spawned.txt");
    const execution = new RunCommand().execute(
      ctx({
        command: [process.execPath, "-e", `await Bun.write(${JSON.stringify(output)}, "spawned")`],
        extraArgs: { [flag]: true },
      }),
    );

    const error = await execution.then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Exit);
    expect((error as Exit).message).toBe(message);
    expect((error as Exit).hint).toContain("after --");
    expect(existsSync(output)).toBe(false);
  });

  test("returns nonzero from the CLI when a global flag precedes the child command", async () => {
    const child = spawnAtlas(["run", "echo", "a", "--version", "b"]);

    expect(await child.exited).toBe(1);
  });

  test("keeps the global version flag working without positionals", async () => {
    const { exitCode, stdout } = await runAtlas(["-v"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(version);
  });

  test("passes child flags through unchanged after the -- delimiter", async () => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), { profiles: {} });

    const { exitCode, stdout } = await runAtlas(["run", "--cwd", project, "--", "echo", "a", "--version", "b"]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("a --version b");
  });

  test.each(["SIGTERM", "SIGINT"] as const)(
    "forwards %s to the direct child and preserves its exit code",
    async (signal) => {
      const project = join(tmpRoot, "repo");
      const ready = join(tmpRoot, "ready.txt");
      const pending = join(tmpRoot, "ready-pending.txt");
      const forwarded = join(tmpRoot, "forwarded.txt");
      mkdirSync(project, { recursive: true });
      writeJson(join(project, ".atlas", "config.json"), { profiles: {} });
      const childScript = [
        'import { renameSync, writeFileSync } from "node:fs";',
        `process.on(${JSON.stringify(signal)}, () => {`,
        `  writeFileSync(${JSON.stringify(forwarded)}, ${JSON.stringify(signal)});`,
        `  process.exit(${SIGNAL_EXIT_CODE});`,
        "});",
        `writeFileSync(${JSON.stringify(pending)}, String(process.pid));`,
        `renameSync(${JSON.stringify(pending)}, ${JSON.stringify(ready)});`,
        `setInterval(() => {}, ${CHILD_KEEPALIVE_INTERVAL_MS});`,
      ].join("\n");
      const atlas = spawnAtlas(["run", "--cwd", project, "--", process.execPath, "-e", childScript]);
      let childPid: number | undefined;
      let lifecycleCompleted = false;

      try {
        const reportedChildPid = await waitForPid(ready);
        childPid = reportedChildPid;

        atlas.kill(signal);
        const exitCode = await withTimeout(atlas.exited);

        expect(exitCode).toBe(SIGNAL_EXIT_CODE);
        expect(readFileSync(forwarded, "utf8")).toBe(signal);
        expect(() => process.kill(reportedChildPid, 0)).toThrow();
        lifecycleCompleted = true;
      } finally {
        if (!lifecycleCompleted) {
          if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid, "SIGKILL");
          if (atlas.exitCode === null) atlas.kill("SIGKILL");
          await withTimeout(atlas.exited).catch(() => undefined);
        }
      }
    },
    TEST_TIMEOUT_MS * 2,
  );
});
