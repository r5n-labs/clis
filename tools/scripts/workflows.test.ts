import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type WorkflowStep = { if?: string; name?: string; run?: string; with?: Record<string, string> };
type ReleaseWorkflow = { jobs: { release: { steps: WorkflowStep[] } } };
type SetupAction = { runs: { steps: WorkflowStep[] } };

const EXECUTABLE_MODE = 0o755;
const REPOSITORY_ROOT = join(import.meta.dir, "../..");
const releaseWorkflow = Bun.YAML.parse(
  readFileSync(join(REPOSITORY_ROOT, ".github/workflows/release.yml"), "utf8"),
) as ReleaseWorkflow;
const setupAction = Bun.YAML.parse(
  readFileSync(join(REPOSITORY_ROOT, "tools/github/setup/action.yml"), "utf8"),
) as SetupAction;
let fixture: string;
let bin: string;

beforeEach(async () => {
  fixture = mkdtempSync(join(tmpdir(), "r5n-workflows-"));
  bin = join(fixture, "bin");
  mkdirSync(bin);
  await Bun.$`git init -q -b main`.cwd(fixture).quiet();
});

afterEach(() => {
  rmSync(fixture, { force: true, recursive: true });
});

async function runShell(script: string, extraEnv: Record<string, string> = {}) {
  const child = Bun.spawn(["bash", "-e", "-c", script], {
    cwd: fixture,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extraEnv },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

describe("repository release workflow", () => {
  test.each([
    { active: false, pending: false, stones: [] },
    { active: true, pending: true, stones: [] },
    { active: false, pending: true, stones: [{ name: "fix" }] },
  ])("detects pending work for %j", async ({ active, pending, stones }) => {
    const checkStep = releaseWorkflow.jobs.release.steps.find((step) => step.name === "Check for pending stones");
    const rollStep = releaseWorkflow.jobs.release.steps.find((step) => step.name === "Roll release");
    expect(rollStep?.if).toBe("env.RELEASE_PENDING == 'true'");
    if (!checkStep?.run) throw new Error("Missing release check script");
    writeFileSync(join(bin, "bun"), '#!/bin/sh\nprintf "%s\\n" "$TEST_STONES_JSON"\n');
    chmodSync(join(bin, "bun"), EXECUTABLE_MODE);
    if (active) {
      mkdirSync(join(fixture, ".git/sisyphus/release"), { recursive: true });
      writeFileSync(join(fixture, ".git/sisyphus/release/active.json"), "{}");
    }
    const envFile = join(fixture, "github env");
    const result = await runShell(checkStep.run, { GITHUB_ENV: envFile, TEST_STONES_JSON: JSON.stringify({ stones }) });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(envFile, "utf8")).toContain(`RELEASE_PENDING=${pending}\n`);
  });
});

describe("dependency install retry", () => {
  test("keeps the committed lockfile and repeats a frozen install", async () => {
    const options = setupAction.runs.steps.find((step) => step.with?.command)?.with;
    if (!options?.command) throw new Error("Missing dependency install step");
    writeFileSync(join(fixture, "bun.lock"), "committed lockfile\n");
    writeFileSync(
      join(bin, "bun"),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$INSTALL_CALLS"',
        'if [ "$1" = "clean" ]; then printf "regenerated\\n" > bun.lock; exit 0; fi',
        'test "$1" = "install" && test "$2" = "--frozen-lockfile" || exit 2',
        'if [ ! -f "$INSTALL_ATTEMPT" ]; then touch "$INSTALL_ATTEMPT"; exit 1; fi',
        "exit 0",
      ].join("\n"),
    );
    chmodSync(join(bin, "bun"), EXECUTABLE_MODE);
    await Bun.$`git add bun.lock`.cwd(fixture).quiet();
    await Bun.$`git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false commit -qm initial`
      .cwd(fixture)
      .quiet();
    const env = { INSTALL_ATTEMPT: join(fixture, "attempt"), INSTALL_CALLS: join(fixture, "calls") };
    expect((await runShell(options.command, env)).exitCode).toBe(1);
    expect((await runShell(options.new_command_on_retry ?? options.command, env)).exitCode).toBe(0);
    expect(readFileSync(join(fixture, "bun.lock"), "utf8")).toBe("committed lockfile\n");
    expect(readFileSync(env.INSTALL_CALLS, "utf8")).toBe("install --frozen-lockfile\ninstall --frozen-lockfile\n");
  });
});
