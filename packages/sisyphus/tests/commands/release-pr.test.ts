import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ActionsReleasePrCommand } from "../../src/commands/actions/release-pr";
import { StoneManager } from "../../src/services/StoneManager";
import {
  type Fixture,
  gitText,
  makeConfig,
  PACKAGE_FILE,
  PACKAGE_NAME,
  STONE_FILE,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";

const RELEASE_BRANCH = "sisyphus/release";

describe("release PR checkout state", () => {
  const originalCwd = process.cwd();
  let fixture: Fixture;
  let providerCalls: string[];

  beforeEach(async () => {
    fixture = await setupReleaseFixture(false);
    providerCalls = [];
    process.chdir(fixture.root);
    await Bun.$`git checkout -qb feature`.quiet();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(fixture.root, { force: true, recursive: true });
    rmSync(fixture.remote, { force: true, recursive: true });
  });

  async function releasePr(dryRun = true) {
    const command = new ActionsReleasePrCommand();
    Reflect.set(command, "provider", {
      createPr: async () => {
        providerCalls.push("create");
        return { number: 42, url: "https://example.invalid/pull/42" };
      },
      ensureLabelExists: async () => {
        providerCalls.push("label");
      },
      findPr: async () => {
        providerCalls.push("find");
        return null;
      },
      getDefaultBranch: async () => "main",
    });
    await command.execute({
      args: { dryRun },
      cli: { name: "SISYPHUS" },
      config: makeConfig(fixture.root),
      interactive: false,
      positionals: {},
    } as Parameters<ActionsReleasePrCommand["execute"]>[0]);
  }

  async function pushFixture() {
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -qm "configure fixture"`.quiet();
    await Bun.$`git push origin HEAD:main`.quiet();
  }

  test("keeps uncommitted work on its branch without silently stashing it", async () => {
    writeFileSync(join(fixture.root, "unrelated.txt"), "uncommitted edits\n");
    writeFileSync(join(fixture.root, "untracked.txt"), "untracked work\n");
    await Bun.$`git add unrelated.txt`.quiet();
    const originalStatus = await gitText(fixture.root, ["status", "--porcelain"]);

    await expect(releasePr()).rejects.toThrow("Working tree must be clean before preparing a release PR");

    expect(await gitText(fixture.root, ["branch", "--show-current"])).toBe("feature");
    expect(await gitText(fixture.root, ["status", "--porcelain"])).toBe(originalStatus);
    expect(await gitText(fixture.root, ["stash", "list"])).toBe("");
    expect(readFileSync(join(fixture.root, "untracked.txt"), "utf8")).toBe("untracked work\n");
  });

  test.each([
    { detached: false, existing: true, fails: false },
    { detached: true, existing: true, fails: true },
    { detached: true, existing: false, fails: false },
  ])("preview preserves refs and restores checkout: %j", async ({ detached, existing, fails }) => {
    if (fails) {
      writeFileSync(
        join(fixture.root, STONE_FILE),
        JSON.stringify({ id: "0001-testtest", message: "stale", patch: ["missing"] }),
      );
      await pushFixture();
    }
    if (existing) {
      await Bun.$`git checkout -qb ${RELEASE_BRANCH}`.quiet();
      await Bun.$`git commit --allow-empty -qm "local release work"`.quiet();
      await Bun.$`git checkout feature`.quiet();
    }
    if (detached) await Bun.$`git checkout --detach`.quiet();
    const head = await gitText(fixture.root, ["rev-parse", "HEAD"]);
    const refs = await gitText(fixture.root, ["show-ref", "--heads"]);
    const remoteRefs = await gitText(fixture.root, ["ls-remote", "--heads", "origin"]);
    if (fails) await expect(releasePr()).rejects.toThrow("Pending stones reference unknown packages: missing");
    else await releasePr();
    expect(await gitText(fixture.root, ["show-ref", "--heads"])).toBe(refs);
    expect(await gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(head);
    expect(await gitText(fixture.root, ["branch", "--show-current"])).toBe(detached ? "" : "feature");
    expect(await gitText(fixture.root, ["status", "--porcelain"])).toBe("");
    expect(await gitText(fixture.root, ["ls-remote", "--heads", "origin"])).toBe(remoteRefs);
    expect(providerCalls).toEqual([]);
  });

  test.each([
    { filename: "CHANGELOG.md", root: false },
    { filename: "HISTORY[release].md", root: true },
  ])("prepares and pushes generated history with config %j", async ({ filename, root }) => {
    const config = makeConfig(fixture.root);
    config.set("changelog", { ...config.get("changelog"), filename, root });
    await pushFixture();
    await releasePr(false);
    const historyPath = `packages/foo/${filename}`;
    const releaseFiles = (await gitText(fixture.root, ["ls-tree", "-r", "--name-only", RELEASE_BRANCH])).split("\n");
    expect(releaseFiles).toContain(historyPath);
    expect(releaseFiles.includes(filename)).toBe(root);
    expect(await gitText(fixture.root, ["show", `${RELEASE_BRANCH}:${historyPath}`])).toContain("1.0.1");
    expect(JSON.parse(await gitText(fixture.root, ["show", `${RELEASE_BRANCH}:${PACKAGE_FILE}`])).version).toBe(
      "1.0.1",
    );
    const prepared = JSON.parse(await gitText(fixture.root, ["show", `${RELEASE_BRANCH}:.sisyphus/config.json`]));
    expect(prepared.currentRelease.packages[PACKAGE_NAME]).toEqual({ newVersion: "1.0.1", oldVersion: "1.0.0" });
    expect(prepared.currentRelease.stoneIds).toEqual(["0001-testtest"]);
    expect(releaseFiles).not.toContain(STONE_FILE);
    expect(releaseFiles).toContain(`.sisyphus/released/${prepared.currentRelease.timestamp}/0001-testtest.json`);
    expect(await gitText(fixture.root, ["rev-parse", `origin/${RELEASE_BRANCH}`])).toBe(
      await gitText(fixture.root, ["rev-parse", RELEASE_BRANCH]),
    );
    expect(providerCalls).toEqual(["find", "label", "create"]);
    expect(await gitText(fixture.root, ["branch", "--show-current"])).toBe("feature");
    expect(await gitText(fixture.root, ["status", "--porcelain"])).toBe("");
  });

  test("staging failure prevents a release commit, push, and provider progression", async () => {
    writeFileSync(join(fixture.root, ".gitignore"), "CHANGELOG.md\n");
    await pushFixture();
    const base = await gitText(fixture.root, ["rev-parse", "HEAD"]);
    const remoteRefs = await gitText(fixture.root, ["ls-remote", "--heads", "origin"]);
    const failure = await releasePr(false).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).not.toBeNull();
    expect((failure as { stderr: Buffer }).stderr.toString()).toContain("ignored by one of your .gitignore files");
    expect(await gitText(fixture.root, ["rev-parse", RELEASE_BRANCH])).toBe(base);
    expect(await gitText(fixture.root, ["ls-remote", "--heads", "origin"])).toBe(remoteRefs);
    expect(providerCalls).toEqual([]);
    expect(readFileSync(join(fixture.root, "packages/foo/CHANGELOG.md"), "utf8")).toContain("1.0.1");
  });

  test("the GitHub stone commit includes the config required by the clean-tree precondition", async () => {
    const templatePath = join(import.meta.dir, "../../src/commands/actions/templates/github/sis-create-stone.yml");
    const workflow = Bun.YAML.parse(await Bun.file(templatePath).text()) as {
      jobs: { "handle-merge": { steps: { name?: string; run?: string }[] } };
    };
    const commitStep = workflow.jobs["handle-merge"].steps.find((step) => step.name === "Commit and push stone");
    if (!commitStep?.run) throw new Error("Expected a stone commit step");
    const manager = new StoneManager(makeConfig(fixture.root));
    const stone = await manager.create({ message: "release fixture", patch: ["@fixture/foo"] });
    await Bun.$`git push -u origin feature`.quiet();

    const script = commitStep.run.replaceAll(/\$\{\{\s*github\.event\.pull_request\.number\s*\}\}/g, "42");
    await Bun.$`bash -e -c ${script}`.quiet();

    expect(await gitText(fixture.root, ["status", "--porcelain"])).toBe("");
    expect(await gitText(fixture.root, ["show", "HEAD:.sisyphus/config.json"])).toContain(stone.id);
  });
});
