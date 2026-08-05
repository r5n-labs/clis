import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { CommitAnalyzer } from "../../src/services/CommitAnalyzer";
import { dependentsOptions } from "../../src/services/dependency-graph";
import { StoneManager } from "../../src/services/StoneManager";
import { WorkspaceScanner } from "../../src/services/WorkspaceScanner";
import type { SisyphusConfig } from "../../src/types";
import { createWorkspaceFixture } from "../helpers/workspace";

async function runGit(cwd: string, args: string[]): Promise<string> {
  const subprocess = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  return stdout.trim();
}

async function initGitWorkspace(root: string): Promise<string> {
  mkdirSync(join(root, "packages/foo/src"), { recursive: true });
  mkdirSync(join(root, "packages/bar/src"), { recursive: true });
  writeFileSync(join(root, "packages/foo/src/index.ts"), "export const foo = 1;\n");
  writeFileSync(join(root, "packages/bar/src/index.ts"), "export const bar = 1;\n");

  await runGit(root, ["init"]);
  await runGit(root, ["config", "user.name", "Fixture"]);
  await runGit(root, ["config", "user.email", "fixture@example.com"]);
  await runGit(root, ["add", "package.json", "packages"]);
  await runGit(root, ["commit", "-m", "chore: initialize fixture"]);
  return runGit(root, ["rev-parse", "HEAD"]);
}

async function commitBothPackages(root: string, message: string): Promise<void> {
  writeFileSync(join(root, "packages/foo/src/index.ts"), "export const foo = 2;\n");
  writeFileSync(join(root, "packages/bar/src/index.ts"), "export const bar = 2;\n");
  await runGit(root, ["add", "packages"]);
  await runGit(root, ["commit", "-m", message]);
}

describe("CommitAnalyzer", () => {
  const originalCwd = process.cwd();
  let root: string;
  let config: ConfigManager<SisyphusConfig>;

  beforeEach(async () => {
    root = createWorkspaceFixture([
      { name: "@fixture/foo", private: true },
      { dependencies: { "@fixture/foo": "workspace:*" }, name: "@fixture/bar", private: true },
    ]);
    const baseCommit = await initGitWorkspace(root);

    process.chdir(root);
    config = new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), SISYPHUS_DEFAULT_CONFIG);
    config.set("lastStone", { commit: baseCommit, date: "2026-07-21" });

    await commitBothPackages(root, "fix: update both packages");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(root, { force: true, recursive: true });
  });

  test("uses filtered package paths for affected commits while preserving dependency closure", async () => {
    const groups = await new CommitAnalyzer(config).analyze({ filter: "foo" });

    expect(groups).toHaveLength(1);
    const group = groups[0];
    if (!group) throw new Error("Expected a commit group for @fixture/foo");
    expect([...group.packages]).toEqual(["@fixture/foo"]);
    expect(group.commits[0]?.packages).toEqual(["@fixture/foo"]);

    const { packages } = await WorkspaceScanner.scan({ filter: "foo" });
    const stoneData = CommitAnalyzer.buildStoneData(group, packages, dependentsOptions(config));
    expect(stoneData.patch).toEqual(["@fixture/foo"]);
    expect(stoneData.dependency).toEqual(["@fixture/bar"]);
  });
});

describe("CommitAnalyzer per-package commit dedup", () => {
  const originalCwd = process.cwd();
  let root: string;
  let config: ConfigManager<SisyphusConfig>;

  beforeEach(async () => {
    root = createWorkspaceFixture([
      { name: "@fixture/foo", private: true },
      { name: "@fixture/bar", private: true },
    ]);
    const baseCommit = await initGitWorkspace(root);

    process.chdir(root);
    config = new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), SISYPHUS_DEFAULT_CONFIG);
    config.set("lastStone", { commit: baseCommit, date: "2026-07-21" });

    await commitBothPackages(root, "fix: update both packages");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(root, { force: true, recursive: true });
  });

  test("a filtered run does not consume the commit for out-of-filter packages", async () => {
    const manager = new StoneManager(config);
    const analyzer = new CommitAnalyzer(config);

    const filteredGroups = await analyzer.analyze({ filter: "foo" });
    expect(filteredGroups).toHaveLength(1);
    const filteredGroup = filteredGroups[0];
    if (!filteredGroup) throw new Error("Expected a commit group for @fixture/foo");
    expect([...filteredGroup.packages]).toEqual(["@fixture/foo"]);

    const { packages: fooPackages } = await WorkspaceScanner.scan({ filter: "foo" });
    const firstStone = await manager.create(
      CommitAnalyzer.buildStoneData(filteredGroup, fooPackages, dependentsOptions(config)),
    );
    expect(firstStone.patch).toEqual(["@fixture/foo"]);

    const groups = await analyzer.analyze();
    expect(groups).toHaveLength(1);
    const group = groups[0];
    if (!group) throw new Error("Expected a commit group for @fixture/bar");
    expect([...group.packages]).toEqual(["@fixture/bar"]);
    expect(group.commits[0]?.packages).toEqual(["@fixture/bar"]);

    const { packages } = await WorkspaceScanner.scan();
    const secondStone = await manager.create(CommitAnalyzer.buildStoneData(group, packages, dependentsOptions(config)));
    expect(secondStone.patch).toEqual(["@fixture/bar"]);
    expect(secondStone.allPackages).not.toContain("@fixture/foo");

    expect(await analyzer.analyze()).toEqual([]);
  });

  test("fully covered commits stay deduplicated for repeat unfiltered runs", async () => {
    const manager = new StoneManager(config);
    const analyzer = new CommitAnalyzer(config);

    const [group] = await analyzer.analyze();
    if (!group) throw new Error("Expected a commit group");
    expect([...group.packages].sort()).toEqual(["@fixture/bar", "@fixture/foo"]);

    const { packages } = await WorkspaceScanner.scan();
    await manager.create(CommitAnalyzer.buildStoneData(group, packages, dependentsOptions(config)));

    expect(await analyzer.analyze()).toEqual([]);
    expect(await analyzer.analyze({ filter: "foo" })).toEqual([]);
  });
});
