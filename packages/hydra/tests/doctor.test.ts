import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveJobHooks, writeJobHooks } from "../src/providers/job-hooks";
import type { HydraConfig, Profile, RunnerEntry } from "../src/types";

const CLI_PATH = resolve(import.meta.dir, "../src/cli.ts");
const EXECUTABLE_MODE = 0o755;
const SUCCESS = 0;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test("doctor reports DNS servers, timed lookups and each runner's job hooks", async () => {
  const root = mkdtempSync(join(tmpdir(), "hydra-doctor-"));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, ".hydra"));
  writeFileSync(
    join(bin, "scutil"),
    "#!/bin/sh\nprintf 'resolver #1\\n  nameserver[0] : 192.0.2.53\\n  nameserver[1] : 192.0.2.54\\nresolver #2\\n  nameserver[0] : 192.0.2.53\\n'\n",
    { mode: EXECUTABLE_MODE },
  );
  writeFileSync(
    join(bin, "dscacheutil"),
    "#!/bin/sh\n[ \"$5\" = github.com ] && printf 'name: github.com\\nip_address: 192.0.2.10\\n\\n'\nexit 0\n",
    { mode: EXECUTABLE_MODE },
  );
  const profile: Profile = {
    directory: join(root, "runners"),
    jobHooks: { dns: { hosts: ["github.com", "api.github.com"] }, workspaceCleanup: { enabled: true } },
    name: "runner",
    numberOfMachines: 3,
    os: "osx",
    overwrite: false,
    provider: "github",
    run: false,
    url: "https://github.com/example/repo",
  };
  const runners: RunnerEntry[] = ["runner-1", "runner-2", "runner-3"].map((id) => {
    const directory = join(profile.directory, id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, ".runner"), JSON.stringify({ agentName: id }));
    return {
      createdAt: new Date().toISOString(),
      directory,
      id,
      name: id,
      profile: "default",
      provider: "github",
      url: profile.url,
    };
  });
  const hooks = resolveJobHooks(profile.jobHooks);
  await writeJobHooks(join(profile.directory, "runner-1"), hooks);
  await writeJobHooks(join(profile.directory, "runner-3"), hooks);
  appendFileSync(join(profile.directory, "runner-3", "hydra-hooks", "job-completed.sh"), "echo edited\n");
  const config: HydraConfig = { defaultProfile: "default", profiles: { default: profile }, runners };
  writeFileSync(join(root, ".hydra/config.json"), JSON.stringify(config));

  const proc = Bun.spawn([process.execPath, CLI_PATH, "doctor"], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const output = stdout + stderr;

  expect(exitCode).toBe(SUCCESS);
  expect(output).toContain("DNS servers 192.0.2.53, 192.0.2.54\n");
  expect(output).toContain("DNS wait: on, up to 120 s");
  expect(output).toMatch(/✓ github\.com \d+ ms · 192\.0\.2\.10/);
  expect(output).toMatch(/✗ api\.github\.com no address after \d+ ms/);
  expect(output).toContain("Workspace cleanup: on, keeps _tool");
  expect(output).toContain("runner-1  registered  DNS wait configured  cleanup configured\n");
  expect(output).toContain("runner-2  registered  DNS wait missing  cleanup missing\n");
  expect(output).toContain("runner-3  registered  DNS wait configured  cleanup outdated\n");
  expect(output).toContain("Run hydra update to write the missing hooks.");
});
