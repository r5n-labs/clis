import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { RollCommand } from "../../src/commands/roll";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { Package, Stone } from "../../src/domain";
import {
  hashReleasePlan,
  hashReleaseSource,
  PackageUpdater,
  ReleaseOrchestrator,
  StoneManager,
  WorkspaceScanner,
} from "../../src/services";
import { ReleaseLedger } from "../../src/services/release-ledger";
import type { SisyphusConfig } from "../../src/types";

const PACKAGE_NAME = "@fixture/foo";
const PACKAGE_FILE = "packages/foo/package.json";
const STONE_ID = "0001-rollsafe";
const STONE_FILE = `.sisyphus/stones/${STONE_ID}.json`;
const RELEASE_TAG = `${PACKAGE_NAME}@1.0.1`;
const PREVIOUS_LAST_STONE = { commit: "previous-baseline", date: "2026-01-02T03:04:05.000Z" };
const LEDGER_SENTINEL = "invalid-ledger-must-not-be-loaded-or-changed\n";

type RollCtx = Parameters<RollCommand["execute"]>[0];

function makeCtx(config: ConfigManager<SisyphusConfig>, args: Partial<RollCtx["args"]> = {}): RollCtx {
  return {
    args: { abort: false, noCommit: false, preview: false, publishOnly: false, yes: true, ...args },
    cli: { name: "SISYPHUS" },
    config,
    interactive: false,
    positionals: {},
  } as RollCtx;
}

async function gitText(root: string, args: string[]): Promise<string> {
  const result = await Bun.$`git ${args}`.cwd(root).quiet();
  return result.stdout.toString().trim();
}

function writeLedgerSentinel(root: string): string {
  const releaseDirectory = join(root, ".git/sisyphus/release");
  const activeLedger = join(releaseDirectory, "active.json");
  mkdirSync(releaseDirectory, { recursive: true });
  writeFileSync(activeLedger, LEDGER_SENTINEL);
  return activeLedger;
}

describe("RollCommand release metadata", () => {
  const originalCwd = process.cwd();
  const originalRegistry = process.env.BUN_CONFIG_REGISTRY;
  const originalToken = process.env.BUN_CONFIG_TOKEN;
  const originalNpmRegistry = process.env.NPM_CONFIG_REGISTRY;
  const originalProvenance = process.env.NPM_CONFIG_PROVENANCE;
  const originalFetchRetries = process.env.NPM_CONFIG_FETCH_RETRIES;
  const originalUserConfig = process.env.NPM_CONFIG_USERCONFIG;
  let config: ConfigManager<SisyphusConfig>;
  let registry: ReturnType<typeof Bun.serve> | undefined;
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "sisyphus-roll-command-"));
    mkdirSync(join(root, "packages/foo"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ name: "fixture-root", private: true, version: "0.0.0", workspaces: ["packages/*"] }, null, 2)}\n`,
    );
    writeFileSync(
      join(root, PACKAGE_FILE),
      `${JSON.stringify({ name: PACKAGE_NAME, private: true, version: "1.0.0" }, null, 2)}\n`,
    );

    const configData = structuredClone(SISYPHUS_DEFAULT_CONFIG);
    configData.changelog.generate = false;
    configData.lastStone = { ...PREVIOUS_LAST_STONE };
    configData.release = { ...configData.release, createRelease: false, npm: false, push: false, tags: false };
    config = new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), configData);
    config.save(configData);

    process.chdir(root);
    const manager = new StoneManager(config);
    await manager.save(Stone.fromJson({ id: STONE_ID, message: "fix: roll", patch: [PACKAGE_NAME] }));

    await Bun.$`git init -q -b main`.cwd(root).quiet();
    await Bun.$`git config user.email committer@test.local`.cwd(root).quiet();
    await Bun.$`git config user.name "Test Committer"`.cwd(root).quiet();
    await Bun.$`git config commit.gpgsign false`.cwd(root).quiet();
    await Bun.$`git config tag.gpgSign false`.cwd(root).quiet();
    await Bun.$`git config core.hooksPath ${join(root, ".git/no-hooks")}`.cwd(root).quiet();
    await Bun.$`git add -A`.cwd(root).quiet();
    await Bun.$`git commit -q -m init`.cwd(root).quiet();
  });

  afterEach(() => {
    registry?.stop(true);
    registry = undefined;
    if (originalRegistry === undefined) delete process.env.BUN_CONFIG_REGISTRY;
    else process.env.BUN_CONFIG_REGISTRY = originalRegistry;
    if (originalToken === undefined) delete process.env.BUN_CONFIG_TOKEN;
    else process.env.BUN_CONFIG_TOKEN = originalToken;
    if (originalNpmRegistry === undefined) delete process.env.NPM_CONFIG_REGISTRY;
    else process.env.NPM_CONFIG_REGISTRY = originalNpmRegistry;
    if (originalProvenance === undefined) delete process.env.NPM_CONFIG_PROVENANCE;
    else process.env.NPM_CONFIG_PROVENANCE = originalProvenance;
    if (originalFetchRetries === undefined) delete process.env.NPM_CONFIG_FETCH_RETRIES;
    else process.env.NPM_CONFIG_FETCH_RETRIES = originalFetchRetries;
    if (originalUserConfig === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
    else process.env.NPM_CONFIG_USERCONFIG = originalUserConfig;
    process.chdir(originalCwd);
    rmSync(root, { force: true, recursive: true });
  });

  test("commits the pre-release baseline marker and leaves the exact config clean", async () => {
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);

    await new RollCommand().execute(makeCtx(config));

    const releaseHead = await gitText(root, ["rev-parse", "HEAD"]);
    const configText = readFileSync(join(root, ".sisyphus/config.json"), "utf-8");
    const committedConfig = (await Bun.$`git show HEAD:.sisyphus/config.json`.cwd(root).quiet()).stdout.toString();
    const releasedConfig = JSON.parse(configText) as SisyphusConfig;

    expect(releaseHead).not.toBe(baseline);
    expect(releasedConfig.lastStone.commit).toBe(baseline);
    expect(Number.isNaN(Date.parse(releasedConfig.lastStone.date))).toBe(false);
    expect(releasedConfig.stones).toEqual([]);
    expect(committedConfig).toBe(configText);
    expect(await gitText(root, ["status", "--porcelain"])).toBe("");
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
  });

  test("restores the exact previous marker, stones, files, and clean index on reversible failure", async () => {
    await Bun.$`git tag ${RELEASE_TAG}`.cwd(root).quiet();
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);
    const originalConfig = readFileSync(join(root, ".sisyphus/config.json"), "utf-8");
    const originalPackage = readFileSync(join(root, PACKAGE_FILE), "utf-8");
    const originalStone = readFileSync(join(root, STONE_FILE), "utf-8");

    await expect(new RollCommand().execute(makeCtx(config, { tags: true }))).rejects.toThrow(
      `Failed to create tag ${RELEASE_TAG}`,
    );

    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    expect(readFileSync(join(root, ".sisyphus/config.json"), "utf-8")).toBe(originalConfig);
    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toBe(originalPackage);
    expect(readFileSync(join(root, STONE_FILE), "utf-8")).toBe(originalStone);
    expect(await gitText(root, ["status", "--porcelain"])).toBe("");
  });

  test("rolls back release-generated files when the commit hook fails", async () => {
    const hooksDirectory = join(root, ".git/no-hooks");
    const hookPath = join(hooksDirectory, "pre-commit");
    mkdirSync(hooksDirectory, { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nexit 1\n");
    chmodSync(hookPath, 0o755);
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);
    const originalConfig = readFileSync(join(root, ".sisyphus/config.json"), "utf-8");
    const originalPackage = readFileSync(join(root, PACKAGE_FILE), "utf-8");
    const originalStone = readFileSync(join(root, STONE_FILE), "utf-8");

    await expect(new RollCommand().execute(makeCtx(config, { push: true }))).rejects.toThrow("Failed to create commit");

    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    expect(readFileSync(join(root, ".sisyphus/config.json"), "utf-8")).toBe(originalConfig);
    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toBe(originalPackage);
    expect(readFileSync(join(root, STONE_FILE), "utf-8")).toBe(originalStone);
    expect(await gitText(root, ["status", "--porcelain"])).toBe("");
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });

  test("preserves release-owned files when a failing commit hook edits them", async () => {
    const hooksDirectory = join(root, ".git/no-hooks");
    const hookPath = join(hooksDirectory, "pre-commit");
    mkdirSync(hooksDirectory, { recursive: true });
    writeFileSync(hookPath, `#!/bin/sh\nprintf '\\nHOOK_EDIT\\n' >> ${PACKAGE_FILE}\nexit 1\n`);
    chmodSync(hookPath, 0o755);

    await expect(new RollCommand().execute(makeCtx(config, { push: true }))).rejects.toThrow(
      "Release failed and rollback could not be completed; local release state was preserved",
    );

    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toContain("HOOK_EDIT");
    expect(await ReleaseLedger.loadActive(root)).not.toBeNull();
  });

  test("no-commit release leaves lastStone metadata unchanged", async () => {
    await new RollCommand().execute(makeCtx(config, { noCommit: true }));

    const releasedConfig = JSON.parse(readFileSync(join(root, ".sisyphus/config.json"), "utf-8")) as SisyphusConfig;
    expect(releasedConfig.lastStone).toEqual(PREVIOUS_LAST_STONE);
  });

  test("preserves the committed baseline marker after the npm boundary is crossed", async () => {
    writeFileSync(
      join(root, PACKAGE_FILE),
      `${JSON.stringify(
        {
          name: PACKAGE_NAME,
          private: false,
          scripts: { build: "bun -e 'void 0'", "package:prepare": "bun -e 'void 0'" },
          version: "1.0.0",
        },
        null,
        2,
      )}\n`,
    );
    await Bun.$`git add ${PACKAGE_FILE}`.cwd(root).quiet();
    await Bun.$`git commit -q -m "make package publishable"`.cwd(root).quiet();
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);

    registry = Bun.serve({
      port: 0,
      async fetch(request) {
        await request.arrayBuffer();
        return Response.json({ ok: false }, { status: 500 });
      },
    });
    process.env.BUN_CONFIG_REGISTRY = String(registry.url);
    process.env.BUN_CONFIG_TOKEN = crypto.randomUUID();
    process.env.NPM_CONFIG_REGISTRY = String(registry.url);
    process.env.NPM_CONFIG_PROVENANCE = "false";
    process.env.NPM_CONFIG_FETCH_RETRIES = "0";
    const registryUrl = new URL(registry.url);
    const userConfig = join(root, ".git/npmrc-test");
    writeFileSync(userConfig, `registry=${registry.url}\n//${registryUrl.host}/:_authToken=test-token\n`);
    process.env.NPM_CONFIG_USERCONFIG = userConfig;

    await expect(new RollCommand().execute(makeCtx(config, { npm: true }))).rejects.toThrow(
      "Release incomplete after npm publication began",
    );

    const releaseHead = await gitText(root, ["rev-parse", "HEAD"]);
    const configText = readFileSync(join(root, ".sisyphus/config.json"), "utf-8");
    const committedConfig = (await Bun.$`git show HEAD:.sisyphus/config.json`.cwd(root).quiet()).stdout.toString();
    const releasedConfig = JSON.parse(configText) as SisyphusConfig;

    expect(releaseHead).not.toBe(baseline);
    expect(releasedConfig.lastStone.commit).toBe(baseline);
    expect(releasedConfig.lastStone).not.toEqual(PREVIOUS_LAST_STONE);
    expect(committedConfig).toBe(configText);
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
    expect(await gitText(root, ["status", "--porcelain"])).toBe("");
  });

  test("preserves the recovery ledger when a package build moves HEAD", async () => {
    writeFileSync(
      join(root, PACKAGE_FILE),
      `${JSON.stringify(
        {
          name: PACKAGE_NAME,
          private: false,
          scripts: { build: 'git commit -q --allow-empty -m "build moved head"', "package:prepare": "bun -e 'void 0'" },
          version: "1.0.0",
        },
        null,
        2,
      )}\n`,
    );
    await Bun.$`git add ${PACKAGE_FILE}`.cwd(root).quiet();
    await Bun.$`git commit -q -m "make package move head"`.cwd(root).quiet();
    process.env.NPM_CONFIG_REGISTRY = "https://registry.npmjs.org/";

    await expect(new RollCommand().execute(makeCtx(config, { npm: true }))).rejects.toThrow(
      "Release failed and rollback could not be completed; local release state was preserved",
    );

    const active = await ReleaseLedger.loadActive(root);
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    expect(active?.data.releaseCommit).toBeDefined();
    expect(active?.data.releaseCommit).not.toBe(head);
    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toContain('"version": "1.0.1"');
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
  });

  test("rejects a traversal-shaped stone during the full roll path before changing packages", async () => {
    rmSync(join(root, STONE_FILE));
    config.set("stones", []);
    writeFileSync(join(root, ".sisyphus/stones/...json"), '{"id":"..","message":"unsafe"}\n');
    await Bun.$`git add -A`.cwd(root).quiet();
    await Bun.$`git commit -q -m "add unsafe stone fixture"`.cwd(root).quiet();
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);
    const originalPackage = readFileSync(join(root, PACKAGE_FILE), "utf-8");

    await expect(new RollCommand().execute(makeCtx(config))).rejects.toThrow('Invalid stone ID ".."');

    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toBe(originalPackage);
    expect(await gitText(root, ["status", "--porcelain"])).toBe("");
  });

  test("rejects a semver-shaped npm dist-tag before creating a release ledger", async () => {
    config.set("tag", "1.2.3");
    await Bun.$`git add .sisyphus/config.json`.cwd(root).quiet();
    await Bun.$`git commit -q -m "configure invalid npm tag"`.cwd(root).quiet();

    await expect(new RollCommand().execute(makeCtx(config, { npm: true }))).rejects.toThrow("Invalid npm dist-tag");

    expect(await ReleaseLedger.loadActive(root)).toBeNull();
    expect(existsSync(join(root, STONE_FILE))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, PACKAGE_FILE), "utf-8")).version).toBe("1.0.0");
  });

  test("rejects every resume operation flag before loading or changing the ledger or invoking resume", async () => {
    const cases: Array<[Partial<RollCtx["args"]>, string]> = [
      [{ changelog: true }, "--changelog"],
      [{ changelog: false }, "--changelog"],
      [{ createRelease: true }, "--createRelease"],
      [{ createRelease: false }, "--createRelease"],
      [{ dryRun: true }, "--dryRun"],
      [{ dryRun: false }, "--dryRun"],
      [{ noCommit: true }, "--noCommit"],
      [{ npm: true }, "--npm"],
      [{ npm: false }, "--npm"],
      [{ preview: true }, "--preview"],
      [{ publishOnly: true }, "--publishOnly"],
      [{ push: true }, "--push"],
      [{ push: false }, "--push"],
      [{ tags: true }, "--tags"],
      [{ tags: false }, "--tags"],
    ];
    const activeLedger = writeLedgerSentinel(root);
    const originalConfig = readFileSync(join(root, ".sisyphus/config.json"), "utf-8");
    const originalPackage = readFileSync(join(root, PACKAGE_FILE), "utf-8");
    const originalStone = readFileSync(join(root, STONE_FILE), "utf-8");
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);
    const resume = spyOn(ReleaseOrchestrator, "resume");

    try {
      for (const [args, flag] of cases) {
        await expect(new RollCommand().execute(makeCtx(config, { ...args, resume: true }))).rejects.toThrow(
          `--resume cannot be combined with ${flag}`,
        );
      }

      expect(resume).not.toHaveBeenCalled();
      expect(readFileSync(activeLedger, "utf-8")).toBe(LEDGER_SENTINEL);
      expect(readFileSync(join(root, ".sisyphus/config.json"), "utf-8")).toBe(originalConfig);
      expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toBe(originalPackage);
      expect(readFileSync(join(root, STONE_FILE), "utf-8")).toBe(originalStone);
      expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    } finally {
      resume.mockRestore();
    }
  });

  test("rejects normal-roll-only flags in publish-only mode before checking the ledger", async () => {
    const cases: Array<[Partial<RollCtx["args"]>, string]> = [
      [{ changelog: true }, "--changelog"],
      [{ noCommit: true }, "--noCommit"],
      [{ preview: true }, "--preview"],
      [{ push: true }, "--push"],
    ];
    const activeLedger = writeLedgerSentinel(root);
    const assertNoActiveRelease = spyOn(ReleaseOrchestrator, "assertNoActiveRelease");

    try {
      for (const [args, flag] of cases) {
        await expect(new RollCommand().execute(makeCtx(config, { ...args, publishOnly: true }))).rejects.toThrow(
          `--publishOnly cannot be combined with ${flag}`,
        );
      }

      expect(assertNoActiveRelease).not.toHaveBeenCalled();
      expect(readFileSync(activeLedger, "utf-8")).toBe(LEDGER_SENTINEL);
      expect(existsSync(join(root, STONE_FILE))).toBe(true);
      expect(JSON.parse(readFileSync(join(root, PACKAGE_FILE), "utf-8")).version).toBe("1.0.0");
    } finally {
      assertNoActiveRelease.mockRestore();
    }
  });

  test("bare resume still dispatches to the recorded release operation", async () => {
    const resume = spyOn(ReleaseOrchestrator, "resume").mockResolvedValue({ ledger: null, packages: [], stones: [] });

    try {
      await expect(new RollCommand().execute(makeCtx(config, { resume: true }))).resolves.toBeUndefined();
      expect(resume).toHaveBeenCalledTimes(1);
    } finally {
      resume.mockRestore();
    }
  });

  test("CLI rejects every resume operation flag before reading or changing an active ledger", async () => {
    const cases: Array<[string, string]> = [
      ["--changelog", "--changelog"],
      ["--no-changelog", "--changelog"],
      ["--create-release", "--createRelease"],
      ["--no-create-release", "--createRelease"],
      ["--dry-run", "--dryRun"],
      ["--no-dry-run", "--dryRun"],
      ["--noCommit", "--noCommit"],
      ["--npm", "--npm"],
      ["--no-npm", "--npm"],
      ["--preview", "--preview"],
      ["--publish-only", "--publishOnly"],
      ["--push", "--push"],
      ["--no-push", "--push"],
      ["--tags", "--tags"],
      ["--no-tags", "--tags"],
    ];
    const activeLedger = writeLedgerSentinel(root);
    const originalConfig = readFileSync(join(root, ".sisyphus/config.json"), "utf-8");
    const originalPackage = readFileSync(join(root, PACKAGE_FILE), "utf-8");
    const originalStone = readFileSync(join(root, STONE_FILE), "utf-8");
    const cliPath = join(import.meta.dir, "../../src/cli.ts");

    for (const [argument, flag] of cases) {
      const subprocess = Bun.spawn([process.execPath, cliPath, "roll", "--resume", argument], {
        cwd: root,
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
        subprocess.exited,
      ]);

      expect(exitCode).not.toBe(0);
      expect(`${stdout}\n${stderr}`).toContain(`--resume cannot be combined with ${flag}`);
      expect(readFileSync(activeLedger, "utf-8")).toBe(LEDGER_SENTINEL);
      expect(readFileSync(join(root, ".sisyphus/config.json"), "utf-8")).toBe(originalConfig);
      expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toBe(originalPackage);
      expect(readFileSync(join(root, STONE_FILE), "utf-8")).toBe(originalStone);
    }
  });

  test("publish-only binds currentRelease packages to the complete archived release plan", async () => {
    const manager = new StoneManager(config);
    const stones = await manager.list();
    const timestamp = await manager.archive(stones);
    writeFileSync(
      join(root, PACKAGE_FILE),
      `${JSON.stringify({ name: PACKAGE_NAME, private: true, version: "1.0.1" }, null, 2)}\n`,
    );
    const sourceHash = await hashReleaseSource(config.get("sisyphusDir"));
    const plan = {
      packages: { [PACKAGE_NAME]: { newVersion: "1.0.1", oldVersion: "1.0.0" } },
      sourceHash,
      stoneIds: [STONE_ID],
      timestamp,
    };
    config.set("currentRelease", {
      ...plan,
      planHash: hashReleasePlan(
        plan,
        stones.map((stone) => stone.toJson()),
      ),
    });
    await Bun.$`git add -A`.cwd(root).quiet();
    await Bun.$`git commit -q -m "prepare publish-only release"`.cwd(root).quiet();

    await expect(
      new RollCommand().execute(makeCtx(config, { dryRun: true, publishOnly: true, tags: true })),
    ).resolves.toBeUndefined();

    await expect(new RollCommand().execute(makeCtx(config, { dryRun: true, publishOnly: true }))).rejects.toThrow(
      "Nothing to publish: npm, tags, and provider release are all disabled",
    );

    const currentRelease = config.get("currentRelease");
    if (!currentRelease) throw new Error("Expected currentRelease");
    config.set("currentRelease", { ...currentRelease, packages: {} });

    await expect(
      new RollCommand().execute(makeCtx(config, { dryRun: true, publishOnly: true, tags: true })),
    ).rejects.toThrow("Prepared release plan has changed");
  });

  test("publish-only preserves workspace edges when validating archived prerelease graduation", async () => {
    writeFileSync(
      join(root, PACKAGE_FILE),
      `${JSON.stringify({ name: PACKAGE_NAME, private: true, version: "1.0.0-beta.1" }, null, 2)}\n`,
    );
    const dependentName = "@fixture/bar";
    mkdirSync(join(root, "packages/bar"), { recursive: true });
    writeFileSync(
      join(root, "packages/bar/package.json"),
      `${JSON.stringify(
        {
          dependencies: { [PACKAGE_NAME]: "workspace:*" },
          name: dependentName,
          private: true,
          version: "2.0.0-beta.2",
        },
        null,
        2,
      )}\n`,
    );
    const manager = new StoneManager(config);
    const stone = Stone.fromJson({
      dependency: [dependentName],
      id: STONE_ID,
      message: "Graduate the dependency chain",
      patch: [PACKAGE_NAME],
    });
    await manager.save(stone);
    const { packages } = await WorkspaceScanner.scan();
    const planned = Package.applyStone(stone, packages);
    expect(planned.map((pkg) => pkg.newVersion)).toEqual(["1.0.0", "2.0.0"]);
    await new PackageUpdater().updateAll(planned);
    const timestamp = await manager.archive([stone]);
    await Bun.$`git add -A`.cwd(root).quiet();
    const sourceHash = await hashReleaseSource(".sisyphus");
    const plan = {
      packages: Object.fromEntries(
        planned.map((pkg) => [pkg.name, { newVersion: pkg.newVersion as string, oldVersion: pkg.version }]),
      ),
      sourceHash,
      stoneIds: [stone.id],
      timestamp,
    };
    config.set("currentRelease", { ...plan, planHash: hashReleasePlan(plan, [stone.toJson()]) });
    await Bun.$`git add -A`.cwd(root).quiet();
    await Bun.$`git commit -q -m "prepare graduating release"`.cwd(root).quiet();

    await expect(
      new RollCommand().execute(makeCtx(config, { dryRun: true, publishOnly: true, tags: true })),
    ).resolves.toBeUndefined();
    expect(await gitText(root, ["status", "--porcelain"])).toBe("");
  });

  test("rejects mixed known and unknown stone packages before changing the release", async () => {
    const manager = new StoneManager(config);
    await manager.save(
      Stone.fromJson({ id: STONE_ID, message: "Release renamed package", patch: [PACKAGE_NAME, "@fixture/gone"] }),
    );
    await Bun.$`git add -A`.cwd(root).quiet();
    await Bun.$`git commit -q -m "record stale package reference"`.cwd(root).quiet();
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);

    await expect(new RollCommand().execute(makeCtx(config))).rejects.toThrow(
      "Pending stones reference unknown packages: @fixture/gone",
    );
    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    expect(await gitText(root, ["status", "--porcelain"])).toBe("");
    expect(existsSync(join(root, STONE_FILE))).toBe(true);
  });

  test("non-TTY roll without --yes proceeds without prompting", async () => {
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);
    const cliPath = join(import.meta.dir, "../../src/cli.ts");
    const subprocess = Bun.spawn([process.execPath, cliPath, "roll"], {
      cwd: root,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(`${stdout}\n${stderr}`).not.toContain("Proceed with release?");
    expect(await gitText(root, ["rev-parse", "HEAD"])).not.toBe(baseline);
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
  }, 20000);

  test("rejects preview combined with dryRun before touching the workspace", async () => {
    const originalPackage = readFileSync(join(root, PACKAGE_FILE), "utf-8");

    await expect(new RollCommand().execute(makeCtx(config, { dryRun: true, preview: true }))).rejects.toThrow(
      "--preview cannot be combined with --dryRun",
    );

    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toBe(originalPackage);
    expect(existsSync(join(root, STONE_FILE))).toBe(true);
  });

  test("rejects explicit release flags combined with --noCommit", async () => {
    await expect(
      new RollCommand().execute(makeCtx(config, { createRelease: true, noCommit: true, push: true, tags: true })),
    ).rejects.toThrow("--noCommit cannot be combined with --createRelease, --push, --tags");
    await expect(new RollCommand().execute(makeCtx(config, { noCommit: true, tags: true }))).rejects.toThrow(
      "--noCommit cannot be combined with --tags",
    );
    expect(existsSync(join(root, STONE_FILE))).toBe(true);

    await expect(new RollCommand().execute(makeCtx(config, { noCommit: true, tags: false }))).resolves.toBeUndefined();
  });

  test("restores hand-formatted config and stone bytes exactly on reversible failure", async () => {
    const configPath = join(root, ".sisyphus/config.json");
    const parsedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as SisyphusConfig;
    const customConfigText = `${JSON.stringify({ ...parsedConfig, tag: parsedConfig.tag }, null, 4)}\n`;
    writeFileSync(configPath, customConfigText);
    const stonePath = join(root, STONE_FILE);
    const customStoneText = `${JSON.stringify(JSON.parse(readFileSync(stonePath, "utf-8")))}\n`;
    writeFileSync(stonePath, customStoneText);
    await Bun.$`git add -A`.cwd(root).quiet();
    await Bun.$`git commit -q -m "hand-format sisyphus metadata"`.cwd(root).quiet();
    await Bun.$`git tag ${RELEASE_TAG}`.cwd(root).quiet();
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);
    const handFormattedConfig = new ConfigManager<SisyphusConfig>(configPath, structuredClone(SISYPHUS_DEFAULT_CONFIG));

    await expect(new RollCommand().execute(makeCtx(handFormattedConfig, { tags: true }))).rejects.toThrow(
      `Failed to create tag ${RELEASE_TAG}`,
    );

    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    expect(readFileSync(configPath, "utf-8")).toBe(customConfigText);
    expect(readFileSync(stonePath, "utf-8")).toBe(customStoneText);
    expect(await gitText(root, ["status", "--porcelain", "--", ".sisyphus/"])).toBe("");
  });

  test("rejects abort combined with any other release flag", async () => {
    const cases: Array<[Partial<RollCtx["args"]>, string]> = [
      [{ changelog: true }, "--changelog"],
      [{ createRelease: false }, "--createRelease"],
      [{ dryRun: true }, "--dryRun"],
      [{ noCommit: true }, "--noCommit"],
      [{ npm: true }, "--npm"],
      [{ preview: true }, "--preview"],
      [{ publishOnly: true }, "--publishOnly"],
      [{ push: false }, "--push"],
      [{ resume: true }, "--resume"],
      [{ tags: true }, "--tags"],
    ];

    for (const [args, flag] of cases) {
      await expect(new RollCommand().execute(makeCtx(config, { ...args, abort: true }))).rejects.toThrow(
        `--abort cannot be combined with ${flag}`,
      );
    }

    expect(existsSync(join(root, STONE_FILE))).toBe(true);
  });

  test("abort without an incomplete release fails closed", async () => {
    await expect(new RollCommand().execute(makeCtx(config, { abort: true }))).rejects.toThrow(
      "No incomplete release found",
    );
  });

  test("abort removes a planned ledger with no external progress", async () => {
    const ledger = await ReleaseLedger.create({
      options: {
        changelog: false,
        createRelease: false,
        dryRun: false,
        npm: false,
        npmTag: "latest",
        publishOnly: false,
        push: false,
        tags: false,
      },
      packages: [{ file: PACKAGE_FILE, isPrivate: true, name: PACKAGE_NAME, newVersion: "1.0.1", oldVersion: "1.0.0" }],
      stones: [],
    });
    expect(ledger.phase).toBe("planned");
    expect(await ReleaseLedger.loadActive(root)).not.toBeNull();

    await new RollCommand().execute(makeCtx(config, { abort: true }));

    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });

  test("abort refuses once an external operation has started", async () => {
    const ledger = await ReleaseLedger.create({
      options: {
        changelog: false,
        createRelease: false,
        dryRun: false,
        npm: true,
        npmTag: "latest",
        publishOnly: false,
        push: false,
        tags: false,
      },
      packages: [
        { file: PACKAGE_FILE, isPrivate: false, name: PACKAGE_NAME, newVersion: "1.0.1", oldVersion: "1.0.0" },
      ],
      stones: [],
    });
    const artifactPath = join(root, "artifact.tgz");
    writeFileSync(artifactPath, "artifact-bytes");
    await ledger.setArtifact(PACKAGE_NAME, artifactPath);
    await ledger.markNpm(PACKAGE_NAME, "started");

    await expect(new RollCommand().execute(makeCtx(config, { abort: true }))).rejects.toThrow(
      "already performed external operations",
    );

    expect(await ReleaseLedger.loadActive(root)).not.toBeNull();
  });

  test("skips ignored-only stones without failing and keeps them on disk", async () => {
    config.set("ignore", [PACKAGE_NAME]);
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);

    await expect(new RollCommand().execute(makeCtx(config))).resolves.toBeUndefined();

    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    expect(existsSync(join(root, STONE_FILE))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, PACKAGE_FILE), "utf-8")).version).toBe("1.0.0");
  });

  test("--json reports an ignored-only release as planned with the warning", async () => {
    config.set("ignore", [PACKAGE_NAME]);
    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });

    try {
      await expect(new RollCommand().execute(makeCtx(config, { json: true }))).resolves.toBeUndefined();
    } finally {
      consoleLog.mockRestore();
    }

    const report = JSON.parse(logged[0] as string);
    expect(report).toMatchObject({ packages: [], published: false, status: "planned", stones: [STONE_ID] });
    expect(report.warnings).toContain("Pending stones reference only ignored packages");
    expect(report.warnings).toContain(`Excluded by config.ignore: ${PACKAGE_NAME}`);
    expect(existsSync(join(root, STONE_FILE))).toBe(true);
  });

  test("an ignored-only stone with a different prerelease tag no longer blocks the release", async () => {
    config.set("ignore", ["@fixture/ghost"]);
    const manager = new StoneManager(config);
    await manager.save(
      Stone.fromJson({ id: "0002-ignored", message: "feat: ghost", patch: ["@fixture/ghost"], tag: "beta" }),
    );
    await Bun.$`git add -A`.cwd(root).quiet();
    await Bun.$`git commit -q -m "add ignored stone"`.cwd(root).quiet();
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);

    await expect(new RollCommand().execute(makeCtx(config))).resolves.toBeUndefined();

    expect(await gitText(root, ["rev-parse", "HEAD"])).not.toBe(baseline);
    expect(JSON.parse(readFileSync(join(root, PACKAGE_FILE), "utf-8")).version).toBe("1.0.1");
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
  });

  test("names the stale packages when stones reference only unknown packages", async () => {
    rmSync(join(root, STONE_FILE));
    config.set("stones", []);
    const manager = new StoneManager(config);
    await manager.save(Stone.fromJson({ id: "0003-ghost", message: "feat: ghost", patch: ["@fixture/ghost"] }));

    await expect(new RollCommand().execute(makeCtx(config))).rejects.toThrow(
      "Pending stones reference unknown packages: @fixture/ghost",
    );

    expect(JSON.parse(readFileSync(join(root, PACKAGE_FILE), "utf-8")).version).toBe("1.0.0");
  });

  test("--json in a TTY refuses to release without --yes", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);
    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    try {
      await expect(new RollCommand().execute(makeCtx(config, { json: true, yes: false }))).rejects.toThrow("exit:1");
    } finally {
      consoleLog.mockRestore();
      consoleError.mockRestore();
      exit.mockRestore();
      if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
    }

    const report = JSON.parse(logged[0] as string);
    expect(report.status).toBe("failed");
    expect(report.error.message).toBe("--json requires --yes in an interactive terminal");
    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    expect(existsSync(join(root, STONE_FILE))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, PACKAGE_FILE), "utf-8")).version).toBe("1.0.0");
  });

  test("--json in a TTY proceeds with --yes", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);
    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });

    try {
      await expect(new RollCommand().execute(makeCtx(config, { json: true, yes: true }))).resolves.toBeUndefined();
    } finally {
      consoleLog.mockRestore();
      if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
    }

    const report = JSON.parse(logged[0] as string);
    expect(report.status).toBe("completed");
    expect(await gitText(root, ["rev-parse", "HEAD"])).not.toBe(baseline);
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
  });

  test("--json surfaces ignore-exclusion warnings in the report", async () => {
    config.set("ignore", ["@fixture/ghost"]);
    rmSync(join(root, STONE_FILE));
    config.set("stones", []);
    const manager = new StoneManager(config);
    await manager.save(
      Stone.fromJson({ id: "0004-mixed", message: "fix: mixed", patch: [PACKAGE_NAME, "@fixture/ghost"] }),
    );
    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });

    try {
      await new RollCommand().execute(makeCtx(config, { dryRun: true, json: true }));
    } finally {
      consoleLog.mockRestore();
    }

    const report = JSON.parse(logged[0] as string);
    expect(report.status).toBe("planned");
    expect(report.warnings).toEqual(["Excluded by config.ignore: @fixture/ghost"]);
    expect(report.packages.map((pkg: { name: string }) => pkg.name)).toEqual([PACKAGE_NAME]);
  });

  test("--json dry-run of a mixed-channel release reports the plan plus a warning", async () => {
    writeFileSync(
      join(root, PACKAGE_FILE),
      `${JSON.stringify({ name: PACKAGE_NAME, private: false, version: "1.0.0" }, null, 2)}\n`,
    );
    mkdirSync(join(root, "packages/bar"), { recursive: true });
    writeFileSync(
      join(root, "packages/bar/package.json"),
      `${JSON.stringify({ name: "@fixture/bar", private: false, version: "1.0.0" }, null, 2)}\n`,
    );
    rmSync(join(root, STONE_FILE));
    config.set("stones", []);
    const manager = new StoneManager(config);
    await manager.save(
      Stone.fromJson({
        id: "0005-channels",
        message: "feat: split",
        patch: [PACKAGE_NAME],
        snapshot: ["@fixture/bar"],
      }),
    );
    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });

    try {
      await new RollCommand().execute(makeCtx(config, { dryRun: true, json: true, npm: true }));
    } finally {
      consoleLog.mockRestore();
    }

    const report = JSON.parse(logged[0] as string);
    expect(report.status).toBe("planned");
    expect(report.operations.npmTag).toBe("latest");
    expect(report.warnings.join("\n")).toContain("Npm publication would fail: Release mixes npm dist-tags");
    expect(report.packages).toHaveLength(2);
  });

  test("--json emits exactly one document and no clack output", async () => {
    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });
    const stdoutWrite = spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await new RollCommand().execute(makeCtx(config, { dryRun: true, json: true, tags: true }));
    } finally {
      consoleLog.mockRestore();
      stdoutWrite.mockRestore();
    }

    expect(logged).toHaveLength(1);
    expect(stdoutWrite).not.toHaveBeenCalled();

    const report = JSON.parse(logged[0] as string);
    expect(report).toMatchObject({
      command: "roll",
      mode: "dry-run",
      published: false,
      publishedPackages: [],
      releaseId: null,
      schemaVersion: 1,
      status: "planned",
      stones: [STONE_ID],
      tags: [RELEASE_TAG],
      warnings: [],
    });
    expect(report.packages).toEqual([
      {
        integrity: null,
        name: PACKAGE_NAME,
        newVersion: "1.0.1",
        oldVersion: "1.0.0",
        private: true,
        published: false,
        registry: null,
        tag: null,
      },
    ]);
    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toContain('"version": "1.0.0"');
  });

  test("--json reports a failure on stdout and exits non-zero", async () => {
    rmSync(join(root, STONE_FILE));
    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });
    const errors: string[] = [];
    const consoleError = spyOn(console, "error").mockImplementation((value) => {
      errors.push(String(value));
    });
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    try {
      await expect(new RollCommand().execute(makeCtx(config, { json: true }))).rejects.toThrow("exit:1");
    } finally {
      consoleLog.mockRestore();
      consoleError.mockRestore();
      exit.mockRestore();
    }

    const report = JSON.parse(logged[0] as string);
    expect(report).toMatchObject({ published: false, status: "failed" });
    expect(report.error.message).toBe("No pending stones found");
    expect(errors).toContain("No pending stones found");
  });

  test("--json is accepted alongside every mode flag", async () => {
    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    try {
      for (const args of [{ abort: true }, { resume: true }, { publishOnly: true }]) {
        await expect(new RollCommand().execute(makeCtx(config, { json: true, ...args }))).rejects.toThrow("exit:1");
      }
    } finally {
      consoleLog.mockRestore();
      consoleError.mockRestore();
      exit.mockRestore();
    }

    const modes = logged.map((entry) => JSON.parse(entry).mode);
    expect(modes).toEqual(["abort", "resume", "publish-only"]);
    expect(logged.every((entry) => JSON.parse(entry).status === "failed")).toBe(true);
  });
});
