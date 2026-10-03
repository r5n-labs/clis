import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { BumpType } from "../../src/domain/BumpType";
import { Commit } from "../../src/domain/Commit";
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
  await runGit(root, ["config", "commit.gpgsign", "false"]);
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

  test("rejects a missing configured baseline rather than analysing the whole history", async () => {
    config.set("lastStone", { commit: "missing-baseline", date: "2026-07-21" });
    await expect(new CommitAnalyzer(config).analyze()).rejects.toThrow("Failed to read commits since missing-baseline");
  });

  test("preserves an empty range when the baseline is already HEAD", async () => {
    expect(await Commit.since(await runGit(root, ["rev-parse", "HEAD"]))).toEqual([]);
  });

  test("rejects an explicitly empty baseline", async () => {
    await expect(Commit.since("")).rejects.toThrow("Failed to read commits since");
  });

  test.each(["żółw.ts", "line\nbreak.ts", "tab\tname.ts"])(
    "attributes an unusual-only change in %j to its package",
    async (filename) => {
      const baseline = await runGit(root, ["rev-parse", "HEAD"]);
      config.set("lastStone", { commit: baseline, date: "2026-07-21" });
      const file = `packages/foo/src/${filename}`;
      writeFileSync(join(root, file), "export const added = true;\n");
      await runGit(root, ["add", "--", file]);
      await runGit(root, ["commit", "-m", "feat: add unusual path"]);

      const groups = await new CommitAnalyzer(config).analyze();

      expect(groups.map(({ bump, packages }) => ({ bump, packages: [...packages] }))).toEqual([
        { bump: BumpType.Minor, packages: ["@fixture/foo"] },
      ]);
      expect(groups[0]?.commits[0]?.packages).toEqual(["@fixture/foo"]);
    },
  );

  test("preserves commit framing and exact paths through range and single-commit retrieval", async () => {
    const baseline = await runGit(root, ["rev-parse", "HEAD"]);
    const subject = "fix: preserve \x1f separators";
    const body = "Details\x1fwith separators\n\nAnother paragraph";
    const files = ["\nleading", "packages/foo/src/\x1f", "packages/foo/src/żółw.ts", "trailing \t"];
    await runGit(root, ["commit", "--allow-empty", "-m", "chore: empty before"]);
    for (const file of files) writeFileSync(join(root, file), "changed\n");
    await runGit(root, ["add", "--", ...files]);
    await runGit(root, ["commit", "-m", subject, "-m", body]);
    const hash = await runGit(root, ["rev-parse", "HEAD"]);
    await runGit(root, ["commit", "--allow-empty", "-m", "chore: empty after"]);

    const commits = await Commit.since(baseline);
    expect(commits.map(({ subject, files }) => ({ files, subject }))).toEqual([
      { files: [], subject: "chore: empty after" },
      { files, subject },
      { files: [], subject: "chore: empty before" },
    ]);
    expect(commits.find((commit) => commit.hash === hash)).toMatchObject({ author: "Fixture", body });
    expect(await Commit.fromHash(hash)).toMatchObject({ author: "Fixture", body, files, hash, subject });

    const initial = await runGit(root, ["rev-list", "--max-parents=0", "HEAD"]);
    expect((await Commit.fromHash(initial))?.files).toEqual([
      "package.json",
      "packages/bar/package.json",
      "packages/bar/src/index.ts",
      "packages/foo/package.json",
      "packages/foo/src/index.ts",
    ]);
  });

  test.each([
    {
      body: "Details\n\nBREAKING CHANGE: remove the old API",
      bump: BumpType.Major,
      subject: "fix: update API",
      type: "fix",
    },
    {
      body: "Refs: #123\nBREAKING-CHANGE: remove the old API",
      bump: BumpType.Major,
      subject: "fix: update API",
      type: "fix",
    },
    { body: undefined, bump: BumpType.Minor, subject: "FeAt(Api): add endpoint", type: "feat" },
    { body: undefined, bump: BumpType.Major, subject: "FEAT!: replace API", type: "feat" },
    { body: undefined, bump: BumpType.Major, subject: "custom!: replace API", type: "other" },
    { body: undefined, bump: BumpType.Patch, subject: "custom: retain fallback", type: "other" },
  ])("classifies $subject with body $body as $bump", async ({ body, bump, subject, type }) => {
    const baseline = await runGit(root, ["rev-parse", "HEAD"]);
    config.set("lastStone", { commit: baseline, date: "2026-07-21" });
    writeFileSync(join(root, "packages/foo/src/index.ts"), "export const foo = 3;\n");
    await runGit(root, ["add", "packages/foo"]);
    await runGit(root, ["commit", "-m", subject, ...(body ? ["-m", body] : [])]);

    const groups = await new CommitAnalyzer(config).analyze();

    expect(groups.map(({ bump, packages }) => ({ bump, packages: [...packages] }))).toEqual([
      { bump, packages: ["@fixture/foo"] },
    ]);
    expect(groups[0]?.commits).toMatchObject([{ body, subject, type }]);
    if (type === "other") expect(groups[0]?.commits[0]?.message).toBe(subject);
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
