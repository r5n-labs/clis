import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ActionsReleasePrCommand } from "../../src/commands/actions/release-pr";
import { StoneManager } from "../../src/services/StoneManager";
import { type Fixture, gitText, makeConfig, STONE_FILE, setupReleaseFixture } from "../helpers/release-orchestrator";

describe("release PR checkout state", () => {
  const originalCwd = process.cwd();
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setupReleaseFixture(false);
    process.chdir(fixture.root);
    rmSync(join(fixture.root, STONE_FILE));
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -qm "remove pending stone"`.quiet();
    await Bun.$`git push origin main`.quiet();
    await Bun.$`git checkout -qb feature`.quiet();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(fixture.root, { force: true, recursive: true });
    rmSync(fixture.remote, { force: true, recursive: true });
  });

  async function releasePr() {
    const command = new ActionsReleasePrCommand();
    Reflect.set(command, "provider", { getDefaultBranch: async () => "main" });
    await command.execute({
      args: { dryRun: true },
      cli: { name: "SISYPHUS" },
      config: makeConfig(fixture.root),
      interactive: false,
      positionals: {},
    } as Parameters<ActionsReleasePrCommand["execute"]>[0]);
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

  test("restores the original feature branch after a clean preview", async () => {
    await releasePr();

    expect(await gitText(fixture.root, ["branch", "--show-current"])).toBe("feature");
    expect(await gitText(fixture.root, ["status", "--porcelain"])).toBe("");
  });

  test("stops release PR preparation when a release file cannot be staged", async () => {
    const command = new ActionsReleasePrCommand();
    const internals = command as unknown as { stageFiles(files: string[]): Promise<void> };
    await expect(internals.stageFiles(["missing-release-file.json"])).rejects.toThrow();
    expect(await gitText(fixture.root, ["diff", "--cached", "--name-only"])).toBe("");
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
