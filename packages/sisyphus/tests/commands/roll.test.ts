import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { RollCommand } from "../../src/commands/roll";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { Stone } from "../../src/domain";
import { hashReleasePlan, hashReleaseSource, StoneManager } from "../../src/services";
import { ReleaseLedger } from "../../src/services/ReleaseLedger";
import type { SisyphusConfig } from "../../src/types";

const PACKAGE_NAME = "@fixture/foo";
const PACKAGE_FILE = "packages/foo/package.json";
const STONE_ID = "0001-rollsafe";
const STONE_FILE = `.sisyphus/stones/${STONE_ID}.json`;
const RELEASE_TAG = `${PACKAGE_NAME}@1.0.1`;
const PREVIOUS_LAST_STONE = { commit: "previous-baseline", date: "2026-01-02T03:04:05.000Z" };

type RollCtx = Parameters<RollCommand["execute"]>[0];

function makeCtx(config: ConfigManager<SisyphusConfig>, args: Partial<RollCtx["args"]> = {}): RollCtx {
  return {
    args: { dryRun: false, noCommit: false, preview: false, publishOnly: false, yes: true, ...args },
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
    configData.release = { createRelease: false, npm: false, push: false, tags: false };
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
      new RollCommand().execute(makeCtx(config, { dryRun: true, publishOnly: true })),
    ).resolves.toBeUndefined();

    const currentRelease = config.get("currentRelease");
    if (!currentRelease) throw new Error("Expected currentRelease");
    config.set("currentRelease", { ...currentRelease, packages: {} });

    await expect(new RollCommand().execute(makeCtx(config, { dryRun: true, publishOnly: true }))).rejects.toThrow(
      "Prepared release plan has changed",
    );
  });
});
