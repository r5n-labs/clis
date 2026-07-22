import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { CommitAnalyzer } from "../../src/services/CommitAnalyzer";
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

describe("CommitAnalyzer", () => {
  const originalCwd = process.cwd();
  let root: string;
  let config: ConfigManager<SisyphusConfig>;

  beforeEach(async () => {
    root = createWorkspaceFixture([
      { name: "@fixture/foo", private: true },
      { name: "@fixture/bar", private: true },
    ]);
    const barManifestPath = join(root, "packages/bar/package.json");
    writeFileSync(
      barManifestPath,
      `${JSON.stringify(
        { dependencies: { "@fixture/foo": "workspace:*" }, name: "@fixture/bar", private: true, version: "1.0.0" },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(root, "packages/foo/src"), { recursive: true });
    mkdirSync(join(root, "packages/bar/src"), { recursive: true });
    writeFileSync(join(root, "packages/foo/src/index.ts"), "export const foo = 1;\n");
    writeFileSync(join(root, "packages/bar/src/index.ts"), "export const bar = 1;\n");

    await runGit(root, ["init"]);
    await runGit(root, ["config", "user.name", "Fixture"]);
    await runGit(root, ["config", "user.email", "fixture@example.com"]);
    await runGit(root, ["add", "package.json", "packages"]);
    await runGit(root, ["commit", "-m", "chore: initialize fixture"]);
    const baseCommit = await runGit(root, ["rev-parse", "HEAD"]);

    process.chdir(root);
    config = new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), SISYPHUS_DEFAULT_CONFIG);
    config.set("lastStone", { commit: baseCommit, date: "2026-07-21" });

    writeFileSync(join(root, "packages/foo/src/index.ts"), "export const foo = 2;\n");
    writeFileSync(join(root, "packages/bar/src/index.ts"), "export const bar = 2;\n");
    await runGit(root, ["add", "packages"]);
    await runGit(root, ["commit", "-m", "fix: update both packages"]);
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
    const stoneData = CommitAnalyzer.buildStoneData(group, packages);
    expect(stoneData.patch).toEqual(["@fixture/foo"]);
    expect(stoneData.dependency).toEqual(["@fixture/bar"]);
  });
});
