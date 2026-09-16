import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitHubRunnerProvider } from "../src/providers/GitHubRunnerProvider";
import type { HydraConfig, Profile, RunnerEntry } from "../src/types";

const CLI_PATH = resolve(import.meta.dir, "../src/cli.ts");
const roots: string[] = [];
const EXECUTABLE_MODE = 0o755;
const VERSION = "1.2.3";
const OLD_VERSION = "1.2.2";
const TEST_TIMEOUT_MS = 5_000;
const POLL_MS = 10;
const SUCCESS = 0;

function script(path: string, source: string) {
  writeFileSync(path, source, { mode: EXECUTABLE_MODE });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hydra-lifecycle-"));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, ".hydra"));
  script(join(bin, "gh"), '#!/bin/sh\ncase "$*" in *releases/latest*) echo v1.2.3;; *) echo fake-token;; esac\n');
  const profile: Profile = {
    directory: join(root, "runners"),
    name: "runner",
    numberOfMachines: 1,
    os: "osx",
    overwrite: false,
    provider: "github",
    run: false,
    url: "https://github.com/example/repo",
  };
  const configPath = join(root, ".hydra/config.json");
  const config: HydraConfig = { defaultProfile: "default", profiles: { default: profile }, runners: [] };
  writeFileSync(configPath, JSON.stringify(config));
  return { bin, config, configPath, profile, root };
}

function addDownload(root: string, version = VERSION) {
  const directory = join(root, ".hydra/shared/github", version);
  mkdirSync(join(directory, "bin"), { recursive: true });
  mkdirSync(join(directory, "externals"));
  writeFileSync(join(directory, "bin/Runner.Listener"), version);
  script(join(directory, "run.sh"), "#!/bin/sh\necho ready > started\nwhile true; do sleep 1; done\n");
  script(
    join(directory, "config.sh"),
    `#!/bin/sh
if [ "$(basename "$PWD")" = "$HYDRA_FAIL_ID" ]; then
  echo "registration service unavailable" >&2
  exit 1
fi
echo "$*" >> "$HYDRA_TEST_ROOT/config-args"
if [ "$1" = remove ]; then
  rm .runner
else
  echo '{"gitHubUrl":"https://github.com/example/repo","agentName":"runner"}' > .runner
  if [ "$HYDRA_FAIL_AFTER_REGISTRATION" = true ]; then exit 1; fi
fi
`,
  );
  return directory;
}

function addRunner(f: ReturnType<typeof fixture>, id: string, profileName = "default", version = OLD_VERSION) {
  const profile = f.config.profiles[profileName];
  if (!profile) throw new Error(`Missing test profile ${profileName}`);
  const directory = join(profile.directory, id);
  mkdirSync(join(directory, "bin"), { recursive: true });
  writeFileSync(join(directory, "bin/Runner.Listener"), version);
  const shared = join(f.root, ".hydra/shared/github", version);
  symlinkSync(join(shared, "externals"), join(directory, "externals"));
  writeFileSync(join(directory, ".runner"), JSON.stringify({ agentName: id, gitHubUrl: profile.url }));
  writeFileSync(join(directory, "config.sh"), readFileSync(join(f.root, ".hydra/shared/github", VERSION, "config.sh")));
  const entry: RunnerEntry = {
    createdAt: new Date().toISOString(),
    directory,
    id,
    name: id,
    profile: profileName,
    provider: "github",
    url: profile.url,
  };
  f.config.runners?.push(entry);
  writeFileSync(f.configPath, JSON.stringify(f.config));
  return directory;
}

async function run(f: ReturnType<typeof fixture>, args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd: f.root,
    env: { ...process.env, HYDRA_TEST_ROOT: f.root, PATH: `${f.bin}:${process.env.PATH}`, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, output: stdout + stderr };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("runner lifecycle", () => {
  test("preserves completed registrations and retries a failed batch without stale directories", async () => {
    const f = fixture();
    addDownload(f.root);

    const failed = await run(f, ["create", "default", "2"], { HYDRA_FAIL_ID: "runner-2" });

    expect(failed.exitCode).not.toBe(SUCCESS);
    expect(JSON.parse(readFileSync(f.configPath, "utf8")).runners.map((entry: RunnerEntry) => entry.id)).toEqual([
      "runner-1",
    ]);
    expect(existsSync(join(f.profile.directory, "runner-2"))).toBe(false);
    expect(readFileSync(join(f.root, "config-args"), "utf8")).toContain("--disableupdate");

    const retried = await run(f, ["create", "default", "2"]);
    expect(retried.exitCode).toBe(SUCCESS);
    expect(JSON.parse(readFileSync(f.configPath, "utf8")).runners).toHaveLength(2);
  });

  test("keeps failed deregistrations recoverable and records completed removals immediately", async () => {
    const f = fixture();
    addDownload(f.root);
    addRunner(f, "runner-1");
    const failedDirectory = addRunner(f, "runner-2");

    const result = await run(f, ["remove", "default"], { HYDRA_FAIL_ID: "runner-2" });

    expect(result.exitCode).not.toBe(SUCCESS);
    expect(result.output).toContain("registration service unavailable");
    expect(JSON.parse(readFileSync(f.configPath, "utf8")).runners.map((entry: RunnerEntry) => entry.id)).toEqual([
      "runner-2",
    ]);
    expect(existsSync(join(failedDirectory, ".runner"))).toBe(true);
    expect(existsSync(join(f.profile.directory, "runner-1"))).toBe(false);
  });

  test("records a partial registration that leaves runner metadata so removal can recover it", async () => {
    const f = fixture();
    addDownload(f.root);

    const result = await run(f, ["create", "default", "1"], { HYDRA_FAIL_AFTER_REGISTRATION: "true" });

    expect(result.exitCode).not.toBe(SUCCESS);
    expect(JSON.parse(readFileSync(f.configPath, "utf8")).runners.map((entry: RunnerEntry) => entry.id)).toEqual([
      "runner-1",
    ]);
    expect(existsSync(join(f.profile.directory, "runner-1/.runner"))).toBe(true);
    expect((await run(f, ["remove", "default"])).exitCode).toBe(SUCCESS);
    expect(JSON.parse(readFileSync(f.configPath, "utf8")).runners).toEqual([]);
  });

  test("updates stale runners in every profile when the first runner is already current", async () => {
    const f = fixture();
    addDownload(f.root);
    addDownload(f.root, OLD_VERSION);
    f.config.profiles.secondary = { ...f.profile, directory: join(f.root, "secondary"), name: "other" };
    addRunner(f, "runner-1", "default", VERSION);
    const sameProfile = addRunner(f, "runner-2");
    const otherProfile = addRunner(f, "other-1", "secondary");

    const result = await run(f, ["update"]);

    expect(result.exitCode).toBe(SUCCESS);
    expect(result.output).toContain("2 runner(s)");
    expect(readFileSync(join(sameProfile, "bin/Runner.Listener"), "utf8")).toBe(VERSION);
    expect(readFileSync(join(otherProfile, "bin/Runner.Listener"), "utf8")).toBe(VERSION);
  });

  test("profile removal preserves its failed runner and can finish on a later attempt", async () => {
    const f = fixture();
    addDownload(f.root);
    addRunner(f, "runner-1");
    addRunner(f, "runner-2");

    const unconfirmed = await run(f, ["profile", "remove", "default"]);
    expect(unconfirmed.exitCode).not.toBe(SUCCESS);
    expect(unconfirmed.output).toContain("Pass --yes");
    const failed = await run(f, ["profile", "remove", "default", "--yes"], { HYDRA_FAIL_ID: "runner-2" });
    expect(failed.exitCode).not.toBe(SUCCESS);
    const remaining = JSON.parse(readFileSync(f.configPath, "utf8")) as HydraConfig;
    expect(remaining.runners?.map((entry) => entry.id)).toEqual(["runner-2"]);
    expect(remaining.profiles.default).toBeDefined();

    const retried = await run(f, ["profile", "remove", "default", "--yes"]);
    expect(retried.exitCode).toBe(SUCCESS);
    expect(JSON.parse(readFileSync(f.configPath, "utf8"))).toEqual({ profiles: {}, runners: [] });
  });

  test("failed downloads leave no reusable cache and a later attempt recovers", async () => {
    const f = fixture();
    const shared = addDownload(f.root);
    const archive = join(f.root, "runner.tar.gz");
    const packed = Bun.spawn(["tar", "czf", archive, "-C", shared, "."]);
    expect(await packed.exited).toBe(SUCCESS);
    rmSync(shared, { recursive: true });
    mkdirSync(shared);
    script(join(f.bin, "curl"), "#!/bin/sh\nexit 22\n");

    const failed = await run(f, ["create", "default", "1"]);

    expect(failed.exitCode).not.toBe(SUCCESS);
    expect(readdirSync(join(f.root, ".hydra/shared/github"))).toEqual([VERSION]);
    script(
      join(f.bin, "curl"),
      '#!/bin/sh\nwhile [ "$1" != -o ]; do shift; done\nshift\ncp "$HYDRA_TEST_ROOT/runner.tar.gz" "$1"\n',
    );
    const retried = await run(f, ["create", "default", "1"]);
    expect(retried.exitCode).toBe(SUCCESS);
    expect(existsSync(join(f.profile.directory, "runner-1/.runner"))).toBe(true);
  });

  test("stops only the selected detached runner and leaves neighbouring runner IDs alive", async () => {
    const f = fixture();
    const shared = addDownload(f.root);
    const ids = ["runner-1", "runner-10"];
    for (const id of ids) {
      const directory = join(f.profile.directory, id);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "run.sh"), readFileSync(join(shared, "run.sh")));
    }
    const provider = new GitHubRunnerProvider(f.profile);
    await provider.start(ids);
    try {
      const deadline = Date.now() + TEST_TIMEOUT_MS;
      while (!ids.every((id) => existsSync(join(f.profile.directory, id, "started")))) {
        if (Date.now() >= deadline) throw new Error("Runner fixture did not start");
        await Bun.sleep(POLL_MS);
      }
      const targetPid = Number(readFileSync(join(f.profile.directory, "runner-1/.pid"), "utf8"));
      const neighbourPid = Number(readFileSync(join(f.profile.directory, "runner-10/.pid"), "utf8"));

      await provider.stop(["runner-1"]);

      expect(() => process.kill(targetPid, SUCCESS)).toThrow();
      expect(() => process.kill(neighbourPid, SUCCESS)).not.toThrow();
      expect(existsSync(join(f.profile.directory, "runner-1/.pid"))).toBe(false);
    } finally {
      await provider.stop(ids);
    }
  });

  test("concurrent downloads publish one complete version and discard their staging directories", async () => {
    const f = fixture();
    const shared = addDownload(f.root);
    const archive = join(f.root, "runner.tar.gz");
    const packed = Bun.spawn(["tar", "czf", archive, "-C", shared, "."]);
    expect(await packed.exited).toBe(SUCCESS);
    rmSync(shared, { recursive: true });
    mkdirSync(shared);
    script(
      join(f.bin, "curl"),
      `#!/bin/sh
touch "$HYDRA_TEST_ROOT/ready-$HYDRA_DOWNLOAD_WORKER"
while [ ! -f "$HYDRA_TEST_ROOT/ready-1" ] || [ ! -f "$HYDRA_TEST_ROOT/ready-2" ]; do sleep 0.01; done
while [ "$1" != -o ]; do shift; done
shift
cp "$HYDRA_TEST_ROOT/runner.tar.gz" "$1"
`,
    );
    const modulePath = resolve(import.meta.dir, "../src/providers/GitHubRunnerProvider.ts");
    const source = `import { GitHubRunnerProvider } from ${JSON.stringify(modulePath)}; await new GitHubRunnerProvider(${JSON.stringify(f.profile)}).download();`;
    const workers = ["1", "2"].map((worker) =>
      Bun.spawn([process.execPath, "--eval", source], {
        cwd: f.root,
        env: {
          ...process.env,
          HYDRA_DOWNLOAD_WORKER: worker,
          HYDRA_TEST_ROOT: f.root,
          PATH: `${f.bin}:${process.env.PATH}`,
        },
        stderr: "pipe",
        stdout: "pipe",
      }),
    );
    try {
      const results = await Promise.all(
        workers.map(async (worker) => ({
          exitCode: await worker.exited,
          stderr: await new Response(worker.stderr).text(),
        })),
      );
      expect(results).toEqual([
        { exitCode: SUCCESS, stderr: "" },
        { exitCode: SUCCESS, stderr: "" },
      ]);
      expect(readFileSync(join(shared, "bin/Runner.Listener"), "utf8")).toBe(VERSION);
      expect(readdirSync(join(f.root, ".hydra/shared"))).toEqual(["github"]);
    } finally {
      for (const worker of workers) worker.kill();
      await Promise.all(workers.map((worker) => worker.exited));
    }
  });
});
