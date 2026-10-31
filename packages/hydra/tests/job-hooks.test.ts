import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DNS_HOOK_HOSTS } from "../src/constants";
import { renderDnsHook } from "../src/providers/job-hook-scripts";
import { resolveJobHooks } from "../src/providers/job-hooks";

const BASH = "/bin/bash";
const EXECUTABLE_MODE = 0o755;
const SUCCESS = 0;
const FAILURE = 1;
const HOOK_TIMEOUT_MS = 15_000;
const MS_PER_SECOND = 1_000;
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

async function runHook(root: string, script: string, env: Record<string, string>) {
  const path = join(root, "hook.sh");
  writeFileSync(path, script);
  const started = performance.now();
  const proc = Bun.spawn([BASH, "-e", path], { cwd: root, env, stderr: "pipe", stdout: "pipe" });
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

describe("job hook settings", () => {
  test("default to the DNS wait on the GitHub hosts for 120 seconds", () => {
    expect(resolveJobHooks(undefined)).toEqual({
      dns: { enabled: true, hosts: [...DEFAULT_DNS_HOOK_HOSTS], timeoutSeconds: 120 },
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
  ])("reject $settings", ({ message, settings }) => {
    expect(() => resolveJobHooks(settings)).toThrow(message);
  });
});
