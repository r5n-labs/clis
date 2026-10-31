import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DNS_HOOK_HOSTS } from "../src/constants";
import { renderCleanupHook, renderDnsHook } from "../src/providers/job-hook-scripts";
import { resolveJobHooks } from "../src/providers/job-hooks";

const BASH = "/bin/bash";
const EXECUTABLE_MODE = 0o755;
const SUCCESS = 0;
const FAILURE = 1;
const HOOK_TIMEOUT_MS = 15_000;
const MS_PER_SECOND = 1_000;
const READ_ONLY_DIR_MODE = 0o500;
const WRITABLE_DIR_MODE = 0o755;
const SYSTEM_PATH = "/usr/bin:/bin";
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hydra-job-hooks-"));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  return { bin, root };
}

function fakeDscacheutil(bin: string) {
  writeFileSync(
    join(bin, "dscacheutil"),
    `#!/bin/sh
echo "$5" >> "$HYDRA_TEST_ROOT/lookups"
count=$(grep -c . "$HYDRA_TEST_ROOT/lookups")
[ "$count" -gt "$HYDRA_DNS_FAILURES" ] || exit 0
printf 'name: %s\\nipv6_address: 2001:db8::1\\n\\n' "$5"
`,
    { mode: EXECUTABLE_MODE },
  );
}

function runnerFixture() {
  const { root } = fixture();
  const runners = join(root, "fleet's runners");
  const runner = join(runners, "runner-1");
  const work = join(runner, "_work");
  const job = join(work, "repo");
  const checkout = join(job, "repo");
  const neighbour = join(runners, "runner-2", "_work", "repo");
  const outside = join(root, "outside");
  for (const directory of [
    join(checkout, "src"),
    join(work, "_temp", "_runner_file_commands"),
    join(work, "_temp", "_github_workflow"),
    join(work, "_tool", "node"),
    join(work, "_actions", "actions", "checkout"),
    join(work, "_PipelineMapping", "owner", "repo"),
    join(work, "earlier-repo"),
    join(runner, "hydra-hooks"),
    neighbour,
    outside,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const file of [
    join(checkout, "src", "index.ts"),
    join(job, "build.log"),
    join(work, "_temp", "_runner_file_commands", "set_env_1"),
    join(work, "_temp", "_github_workflow", "event.json"),
    join(work, "_temp", "step.sh"),
    join(work, "_temp", ".npmrc"),
    join(work, "_tool", "node", "bin"),
    join(neighbour, "keep"),
    join(outside, "keep"),
  ]) {
    writeFileSync(file, "");
  }
  symlinkSync(outside, join(checkout, "linked-outside"));
  return { checkout, job, neighbour, outside, root, runner, work };
}

function cleanupHook(runner: string, keepToolCache = true) {
  return renderCleanupHook(runner, { enabled: true, keepToolCache });
}

async function runHook(root: string, script: string, env: Record<string, string>, cwd = root) {
  const path = join(root, "hook.sh");
  writeFileSync(path, script);
  const started = performance.now();
  const proc = Bun.spawn([BASH, "-e", path], { cwd, env, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { elapsedMs: performance.now() - started, exitCode, output: stdout + stderr };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("DNS job-started hook", () => {
  test(
    "lets the job start silently when every configured host resolves",
    async () => {
      const { bin, root } = fixture();
      fakeDscacheutil(bin);
      const hosts = ["github.com", "pipelines.actions.githubusercontent.com"];

      const result = await runHook(root, renderDnsHook({ enabled: true, hosts, timeoutSeconds: 5 }), {
        HYDRA_DNS_FAILURES: "0",
        HYDRA_TEST_ROOT: root,
        PATH: `${bin}:/usr/bin:/bin`,
      });

      expect(result).toMatchObject({ exitCode: SUCCESS, output: "" });
      expect(readFileSync(join(root, "lookups"), "utf8")).toBe(`${hosts.join("\n")}\n`);
    },
    HOOK_TIMEOUT_MS,
  );

  test(
    "waits for lookups to recover, retries only unresolved hosts and warns how long it waited",
    async () => {
      const { bin, root } = fixture();
      fakeDscacheutil(bin);

      const result = await runHook(
        root,
        renderDnsHook({ enabled: true, hosts: ["github.com", "api.github.com"], timeoutSeconds: 10 }),
        { HYDRA_DNS_FAILURES: "3", HYDRA_TEST_ROOT: root, PATH: `${bin}:/usr/bin:/bin` },
      );

      expect(result.exitCode).toBe(SUCCESS);
      expect(result.output).toContain("Waiting up to 10 s for DNS: github.com api.github.com");
      expect(result.output).toMatch(/::warning::DNS recovered after [1-3] s/);
      expect(readFileSync(join(root, "lookups"), "utf8").trim().split("\n")).toEqual([
        "github.com",
        "api.github.com",
        "github.com",
        "api.github.com",
        "github.com",
      ]);
    },
    HOOK_TIMEOUT_MS,
  );

  test(
    "fails the job with an error annotation once the timeout passes",
    async () => {
      const { bin, root } = fixture();
      fakeDscacheutil(bin);
      const timeoutSeconds = 2;

      const result = await runHook(
        root,
        renderDnsHook({ enabled: true, hosts: ["github.com", "api.github.com"], timeoutSeconds }),
        { HYDRA_DNS_FAILURES: "1000", HYDRA_TEST_ROOT: root, PATH: `${bin}:/usr/bin:/bin` },
      );

      expect(result.exitCode).toBe(FAILURE);
      expect(result.output).toContain("::error::DNS did not recover within 2 s; unresolved: github.com api.github.com");
      expect(result.elapsedMs).toBeGreaterThanOrEqual((timeoutSeconds - 1) * MS_PER_SECOND);
    },
    HOOK_TIMEOUT_MS,
  );

  test("skips the check with a warning instead of failing jobs when no resolver command exists", async () => {
    const { bin, root } = fixture();

    const result = await runHook(root, renderDnsHook({ enabled: true, hosts: ["github.com"], timeoutSeconds: 5 }), {
      PATH: bin,
    });

    expect(result).toMatchObject({
      exitCode: SUCCESS,
      output: "::warning::Hydra skipped the DNS check: neither dscacheutil nor getent is available\n",
    });
    expect(existsSync(join(root, "lookups"))).toBe(false);
  });
});

describe("workspace cleanup job-completed hook", () => {
  test("removes only this job's workspace and temporary files, keeping runner state, caches and neighbours", async () => {
    const f = runnerFixture();

    const result = await runHook(
      f.root,
      cleanupHook(f.runner),
      { GITHUB_WORKSPACE: f.checkout, PATH: SYSTEM_PATH, RUNNER_WORKSPACE: f.job },
      f.checkout,
    );

    expect(result.exitCode).toBe(SUCCESS);
    expect(result.output).not.toContain("::warning::");
    expect(result.output).toContain("Hydra cleanup: removed ");
    expect(existsSync(f.job)).toBe(false);
    expect(readdirSync(join(f.work, "_temp")).sort()).toEqual(["_github_workflow", "_runner_file_commands"]);
    expect(readdirSync(f.work).sort()).toEqual(["_PipelineMapping", "_actions", "_temp", "_tool", "earlier-repo"]);
    expect(existsSync(join(f.work, "_tool", "node", "bin"))).toBe(true);
    expect(existsSync(join(f.neighbour, "keep"))).toBe(true);
    expect(existsSync(join(f.outside, "keep"))).toBe(true);
    expect(existsSync(join(f.runner, "hydra-hooks"))).toBe(true);
  });

  test("also empties the tool cache when keepToolCache is off", async () => {
    const f = runnerFixture();

    const result = await runHook(f.root, cleanupHook(f.runner, false), { PATH: SYSTEM_PATH, RUNNER_WORKSPACE: f.job });

    expect(result.exitCode).toBe(SUCCESS);
    expect(readdirSync(join(f.work, "_tool"))).toEqual([]);
    expect(existsSync(join(f.work, "_actions", "actions", "checkout"))).toBe(true);
  });

  test.each([
    {
      case: "an unset workspace",
      env: () => ({}),
      kept: (f: ReturnType<typeof runnerFixture>) => [join(f.checkout, "src", "index.ts")],
      warning: "the job workspace is not set",
    },
    {
      case: "an empty workspace",
      env: () => ({ GITHUB_WORKSPACE: "", RUNNER_WORKSPACE: "" }),
      kept: (f: ReturnType<typeof runnerFixture>) => [join(f.checkout, "src", "index.ts")],
      warning: "the job workspace is not set",
    },
    {
      case: "a relative workspace",
      env: () => ({ RUNNER_WORKSPACE: "repo" }),
      kept: (f: ReturnType<typeof runnerFixture>) => [join(f.checkout, "src", "index.ts")],
      warning: "it is not an absolute path",
    },
    {
      case: "a workspace symlink that escapes _work",
      env: (f: ReturnType<typeof runnerFixture>) => {
        symlinkSync(f.outside, join(f.work, "escape"));
        return { RUNNER_WORKSPACE: join(f.work, "escape") };
      },
      kept: (f: ReturnType<typeof runnerFixture>) => [join(f.outside, "keep"), join(f.work, "escape")],
      warning: "which is not inside",
    },
    {
      case: "another runner's workspace",
      env: (f: ReturnType<typeof runnerFixture>) => ({ RUNNER_WORKSPACE: f.neighbour }),
      kept: (f: ReturnType<typeof runnerFixture>) => [join(f.neighbour, "keep")],
      warning: "which is not inside",
    },
    {
      case: "a symlink to another runner's workspace",
      env: (f: ReturnType<typeof runnerFixture>) => {
        symlinkSync(f.neighbour, join(f.work, "neighbour"));
        return { RUNNER_WORKSPACE: join(f.work, "neighbour") };
      },
      kept: (f: ReturnType<typeof runnerFixture>) => [join(f.neighbour, "keep")],
      warning: "which is not inside",
    },
    {
      case: "the _work directory itself",
      env: (f: ReturnType<typeof runnerFixture>) => ({ RUNNER_WORKSPACE: f.work }),
      kept: (f: ReturnType<typeof runnerFixture>) => [join(f.checkout, "src", "index.ts"), join(f.work, "_actions")],
      warning: "which is not inside",
    },
    {
      case: "a runner-owned directory",
      env: (f: ReturnType<typeof runnerFixture>) => ({ RUNNER_WORKSPACE: join(f.work, "_tool", "node") }),
      kept: (f: ReturnType<typeof runnerFixture>) => [join(f.work, "_tool", "node", "bin")],
      warning: "it belongs to the runner",
    },
  ])("refuses $case and still exits 0", async ({ env, kept, warning }) => {
    const f = runnerFixture();

    const result = await runHook(f.root, cleanupHook(f.runner), { PATH: SYSTEM_PATH, ...env(f) });

    expect(result.exitCode).toBe(SUCCESS);
    expect(result.output).toContain("::warning::Hydra cleanup: ");
    expect(result.output).toContain(warning);
    for (const path of kept(f)) expect(existsSync(path)).toBe(true);
    expect(existsSync(join(f.outside, "keep"))).toBe(true);
    expect(existsSync(join(f.neighbour, "keep"))).toBe(true);
  });

  test.each(["_work", "_work/_temp"])("refuses to follow a symlinked %s out of the runner", async (linked) => {
    const f = runnerFixture();
    const path = join(f.runner, linked);
    rmSync(path, { recursive: true });
    symlinkSync(f.outside, path);

    const result = await runHook(f.root, cleanupHook(f.runner), { PATH: SYSTEM_PATH, RUNNER_WORKSPACE: f.job });

    expect(result.exitCode).toBe(SUCCESS);
    expect(result.output).toContain("it is a symbolic link");
    expect(readdirSync(f.outside)).toEqual(["keep"]);
  });

  test("logs a removal it cannot finish and still exits 0", async () => {
    const f = runnerFixture();
    const locked = join(f.checkout, "src");
    chmodSync(locked, READ_ONLY_DIR_MODE);

    try {
      const result = await runHook(f.root, cleanupHook(f.runner), { PATH: SYSTEM_PATH, RUNNER_WORKSPACE: f.job });

      expect(result.exitCode).toBe(SUCCESS);
      expect(result.output).toContain(`::warning::Hydra cleanup: could not remove ${realpathSync(f.job)}: rm: `);
      expect(existsSync(join(locked, "index.ts"))).toBe(true);
      expect(readdirSync(join(f.work, "_temp")).sort()).toEqual(["_github_workflow", "_runner_file_commands"]);
    } finally {
      chmodSync(locked, WRITABLE_DIR_MODE);
    }
  });
});

describe("job hook settings", () => {
  test("default to the DNS wait and leave workspace cleanup off for profiles without settings", () => {
    expect(resolveJobHooks(undefined)).toEqual({
      dns: { enabled: true, hosts: [...DEFAULT_DNS_HOOK_HOSTS], timeoutSeconds: 120 },
      workspaceCleanup: { enabled: false, keepToolCache: true },
    });
    expect(resolveJobHooks({ dns: { timeoutSeconds: 30 } }).dns).toEqual({
      enabled: true,
      hosts: [...DEFAULT_DNS_HOOK_HOSTS],
      timeoutSeconds: 30,
    });
  });

  test.each([
    { message: "Invalid jobHooks: expected an object", settings: [] },
    { message: "Unknown jobHooks setting: dnsWait", settings: { dnsWait: {} } },
    { message: "Unknown jobHooks.dns setting: timeout", settings: { dns: { timeout: 60 } } },
    { message: "Invalid jobHooks.dns.enabled", settings: { dns: { enabled: "yes" } } },
    { message: "Invalid jobHooks.dns.hosts", settings: { dns: { hosts: [] } } },
    { message: "Invalid jobHooks.dns.hosts", settings: { dns: { hosts: ["github.com; touch /tmp/pwned"] } } },
    { message: "Invalid jobHooks.dns.hosts", settings: { dns: { hosts: ["-q"] } } },
    { message: "Invalid jobHooks.dns.timeoutSeconds", settings: { dns: { timeoutSeconds: 0 } } },
    { message: "Invalid jobHooks.dns.timeoutSeconds", settings: { dns: { timeoutSeconds: 1.5 } } },
    { message: "Unknown jobHooks.workspaceCleanup setting: enable", settings: { workspaceCleanup: { enable: true } } },
    {
      message: "Invalid jobHooks.workspaceCleanup.keepToolCache",
      settings: { workspaceCleanup: { keepToolCache: 0 } },
    },
  ])("reject $settings", ({ message, settings }) => {
    expect(() => resolveJobHooks(settings)).toThrow(message);
  });
});
