import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { BumpType } from "../../src/domain/BumpType";
import { Package } from "../../src/domain/Package";
import { ReleaseOrchestrator } from "../../src/services/ReleaseOrchestrator";
import { ReleaseLedger } from "../../src/services/release-ledger";
import { StoneManager } from "../../src/services/StoneManager";
import {
  BASE_OPTIONS,
  CHANGELOG_FILE,
  type Fixture,
  gitText,
  makeConfig,
  makeOrchestrator,
  makePackage,
  makePendingStone,
  PACKAGE_FILE,
  PACKAGE_NAME,
  RELEASE_TAG,
  STONE_FILE,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";

describe("ReleaseOrchestrator release flow", () => {
  const originalCwd = process.cwd();
  let fixture: Fixture | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (fixture) {
      rmSync(fixture.root, { force: true, recursive: true });
      rmSync(fixture.remote, { force: true, recursive: true });
    }
    fixture = undefined;
  });

  test("atomically pushes the current branch and exact release tags to the configured push remote", async () => {
    fixture = await setupReleaseFixture(true);
    const { root, remote } = fixture;
    process.chdir(root);

    const publishRemote = join(root, "publish.git");
    await Bun.$`git init -q --bare ${publishRemote}`.quiet();
    await Bun.$`git remote add publish ${publishRemote}`.quiet();
    await Bun.$`git push -q publish main`.quiet();
    await Bun.$`git config branch.main.pushRemote publish`.quiet();
    await Bun.$`git tag unrelated-local`.quiet();

    const orchestrator = makeOrchestrator(root, { push: true });
    const pkg = makePackage();
    const stone = makePendingStone();
    const initialHead = await gitText(root, ["rev-parse", "HEAD"]);

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));

    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);
    await orchestrator.pushRelease();

    const head = await gitText(root, ["rev-parse", "HEAD"]);
    expect(head).not.toBe(initialHead);
    expect(await gitText(root, ["log", "-1", "--pretty=%s"])).toBe("chore(release): ship it");

    const tagTarget = await gitText(root, ["rev-list", "-n", "1", RELEASE_TAG]);
    expect(tagTarget).toBe(head);

    const remoteRefs = await gitText(root, ["ls-remote", publishRemote]);
    const mainRef = remoteRefs.split("\n").find((line) => line.endsWith("refs/heads/main"));
    const tagRef = remoteRefs.split("\n").find((line) => line.endsWith(`refs/tags/${RELEASE_TAG}`));
    expect(mainRef?.startsWith(head)).toBe(true);
    expect(tagRef?.startsWith(head)).toBe(true);
    expect(remoteRefs).not.toContain("refs/tags/unrelated-local");

    const originMain = (await gitText(root, ["ls-remote", remote, "refs/heads/main"])).split("\t")[0]?.trim();
    expect(originMain).toBe(initialHead);

    expect(await orchestrator.rollback()).toBe(false);
    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(head);
    expect(await gitText(root, ["rev-parse", RELEASE_TAG])).toBe(head);
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toContain('"version": "1.0.1"');
  });

  test("stages only release files - unrelated changes stay out of the commit", async () => {
    fixture = await setupReleaseFixture(true);
    const { root } = fixture;
    process.chdir(root);

    const orchestrator = makeOrchestrator(root);
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));
    writeFileSync(join(root, "unrelated.txt"), "drive-by change\n");
    writeFileSync(join(root, "junk.txt"), "untracked\n");
    await Bun.$`git add unrelated.txt`.quiet();

    await orchestrator.createCommit(stone, [pkg], [stone]);

    const committed = (await gitText(root, ["show", "--name-status", "--pretty=format:", "HEAD"]))
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"));
    const committedPaths = committed.map(([, path]) => path);

    expect(committedPaths).toContain(PACKAGE_FILE);
    expect(committedPaths).toContain(CHANGELOG_FILE);
    expect(committed).toContainEqual(["D", STONE_FILE]);
    expect(committedPaths).not.toContain("unrelated.txt");
    expect(committedPaths).not.toContain("junk.txt");

    const status = await gitText(root, ["status", "--porcelain"]);
    expect(status).toContain("M  unrelated.txt");
    expect(status).toContain("?? junk.txt");
  });

  test("createCommit succeeds without changelog files when changelog generation is off", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const orchestrator = makeOrchestrator(root, { changelog: false });
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));

    await orchestrator.createCommit(stone, [pkg], [stone]);

    const committedPaths = (await gitText(root, ["show", "--name-only", "--pretty=format:", "HEAD"]))
      .split("\n")
      .filter(Boolean);
    expect(committedPaths).toContain(PACKAGE_FILE);
    expect(committedPaths).toContain(STONE_FILE);
    expect(await gitText(root, ["log", "-1", "--pretty=%s"])).toBe("chore(release): ship it");
  });

  test("allows pre-existing unrelated changes inside the Sisyphus directory", async () => {
    fixture = await setupReleaseFixture(true);
    const { root } = fixture;
    process.chdir(root);

    const unrelatedSisyphusFile = ".sisyphus/notes.txt";
    writeFileSync(join(root, unrelatedSisyphusFile), "tracked\n");
    await Bun.$`git add ${unrelatedSisyphusFile}`.quiet();
    await Bun.$`git commit -q -m "add notes"`.quiet();
    writeFileSync(join(root, unrelatedSisyphusFile), "unrelated change\n");

    const orchestrator = makeOrchestrator(root);
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);

    const committedPaths = await gitText(root, ["show", "--name-only", "--pretty=format:", "HEAD"]);
    expect(committedPaths).not.toContain(unrelatedSisyphusFile);
    expect(await gitText(root, ["status", "--porcelain", "--", unrelatedSisyphusFile])).toContain(
      unrelatedSisyphusFile,
    );
  });

  test("rejects a dirty changelog before changing release files", async () => {
    fixture = await setupReleaseFixture(true);
    const { root } = fixture;
    process.chdir(root);

    appendFileSync(join(root, CHANGELOG_FILE), "dirty\n");
    const orchestrator = makeOrchestrator(root);

    await expect(orchestrator.preflight([makePackage()], [makePendingStone()])).rejects.toThrow(
      "Release files have uncommitted changes",
    );
  });

  test("rejects a dirty Sisyphus config before changing release files", async () => {
    fixture = await setupReleaseFixture(true);
    const { root } = fixture;
    process.chdir(root);

    appendFileSync(join(root, ".sisyphus/config.json"), "\n");
    const orchestrator = makeOrchestrator(root);

    await expect(orchestrator.preflight([makePackage()], [makePendingStone()])).rejects.toThrow(
      "Release files have uncommitted changes",
    );
  });

  test("uses the configured custom stones path for preflight and commit", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const customStoneFile = "custom/stones/0001-testtest.json";
    mkdirSync(join(root, "custom/stones"), { recursive: true });
    renameSync(join(root, STONE_FILE), join(root, customStoneFile));

    const configPath = join(root, ".sisyphus/config.json");
    const configJson = JSON.parse(readFileSync(configPath, "utf-8"));
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...configJson, stones: ["0001-testtest"], stonesPath: "custom/stones" }, null, 2)}\n`,
    );
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "configure custom stones"`.quiet();

    const config = makeConfig(root);
    const manager = new StoneManager(config);
    const orchestrator = new ReleaseOrchestrator(config, { ...BASE_OPTIONS, changelog: false });
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    await manager.delete(stone.id);
    await orchestrator.createCommit(stone, [pkg], [stone]);

    const committed = await gitText(root, ["show", "--name-status", "--pretty=format:", "HEAD"]);
    expect(committed).toContain(`D\t${customStoneFile}`);
    expect(committed).toContain("M\t.sisyphus/config.json");
    expect(committed).not.toContain(STONE_FILE);
  });

  test("treats release paths containing Git pathspec metacharacters literally", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const literalPackageFile = "packages/foo/package[release].json";
    const patternMatchFile = "packages/foo/packager.json";
    const packageJson = `${JSON.stringify({ name: PACKAGE_NAME, private: true, version: "1.0.0" }, null, 2)}\n`;
    writeFileSync(join(root, literalPackageFile), packageJson);
    writeFileSync(join(root, patternMatchFile), "tracked\n");
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "add literal package path"`.quiet();
    writeFileSync(join(root, patternMatchFile), "unrelated change\n");

    const pkg = new Package({ bump: BumpType.Patch, file: literalPackageFile, name: PACKAGE_NAME, version: "1.0.0" });
    const stone = makePendingStone();
    const orchestrator = makeOrchestrator(root, { changelog: false });

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);

    const committedPaths = await gitText(root, ["show", "--name-only", "--pretty=format:", "HEAD"]);
    expect(committedPaths).toContain(literalPackageFile);
    expect(committedPaths).not.toContain(patternMatchFile);
    expect(await gitText(root, ["status", "--porcelain", "--", patternMatchFile])).toContain(patternMatchFile);
  });

  test("unstages only release-owned paths when the commit hook fails", async () => {
    fixture = await setupReleaseFixture(true);
    const { root } = fixture;
    process.chdir(root);

    const hooksPath = join(root, ".git/test-hooks");
    const hookPath = join(hooksPath, "pre-commit");
    mkdirSync(hooksPath, { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nexit 1\n");
    chmodSync(hookPath, 0o755);
    await Bun.$`git config core.hooksPath ${hooksPath}`.quiet();

    writeFileSync(join(root, "unrelated.txt"), "staged unrelated change\n");
    await Bun.$`git add unrelated.txt`.quiet();

    const orchestrator = makeOrchestrator(root, { push: true });
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));

    await expect(orchestrator.createCommit(stone, [pkg], [stone])).rejects.toThrow("Failed to create commit");

    const stagedPaths = (await gitText(root, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
    expect(stagedPaths).toEqual(["unrelated.txt"]);
    const active = await ReleaseLedger.loadActive(root);
    expect(active?.data.expectedReleaseTree).toMatch(/^[0-9a-f]{40}$/);
    expect(active?.data.releaseCommit).toBeUndefined();
  });

  test("unstages partially added release paths when git add fails", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    writeFileSync(join(root, ".gitignore"), `${CHANGELOG_FILE}\n`);
    await Bun.$`git add .gitignore`.quiet();
    await Bun.$`git commit -q -m "ignore generated changelog"`.quiet();

    writeFileSync(join(root, "unrelated.txt"), "staged unrelated change\n");
    await Bun.$`git add unrelated.txt`.quiet();

    const orchestrator = makeOrchestrator(root);
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    writeFileSync(join(root, CHANGELOG_FILE), "ignored generated changelog\n");
    rmSync(join(root, STONE_FILE));

    await expect(orchestrator.createCommit(stone, [pkg], [stone])).rejects.toThrow("Failed to stage release files");

    const stagedPaths = (await gitText(root, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
    expect(stagedPaths).toEqual(["unrelated.txt"]);
  });

  test("untouched default release author creates a valid commit", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    writeFileSync(join(root, ".sisyphus/config.json"), "{}\n");
    await Bun.$`git add .sisyphus/config.json`.quiet();
    await Bun.$`git commit -q -m "use defaults"`.quiet();

    const orchestrator = makeOrchestrator(root, { changelog: false });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));

    await orchestrator.createCommit(stone, [pkg], [stone]);

    expect(await gitText(root, ["log", "-1", "--pretty=%an <%ae>"])).toBe("r5n-bot <r5n-bot@users.noreply.github.com>");
  });

  test("rejects an incomplete custom author before staging release paths", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    writeFileSync(
      join(root, ".sisyphus/config.json"),
      `${JSON.stringify({ commit: { author: "Custom Bot", email: "", message: "release: {message}" } }, null, 2)}\n`,
    );
    await Bun.$`git add .sisyphus/config.json`.quiet();
    await Bun.$`git commit -q -m "configure incomplete author"`.quiet();

    writeFileSync(join(root, "unrelated.txt"), "staged unrelated change\n");
    await Bun.$`git add unrelated.txt`.quiet();

    const orchestrator = makeOrchestrator(root, { changelog: false });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));

    await expect(orchestrator.createCommit(stone, [pkg], [stone])).rejects.toThrow("Invalid release commit author");

    const stagedPaths = (await gitText(root, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
    expect(stagedPaths).toEqual(["unrelated.txt"]);
  });

  test("uses an atomic push so a rejected release tag cannot update the branch", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);

    const updateHook = join(remote, "hooks/update");
    writeFileSync(updateHook, '#!/bin/sh\ncase "$1" in\n  refs/tags/*) exit 1 ;;\nesac\nexit 0\n');
    chmodSync(updateHook, 0o755);

    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    const pkg = makePackage();
    const stone = makePendingStone();
    const initialRemoteHead = await gitText(root, ["rev-parse", "origin/main"]);

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);

    await expect(orchestrator.pushRelease()).rejects.toThrow("Failed to atomically push release refs");

    const remoteHead = (await gitText(root, ["ls-remote", remote, "refs/heads/main"])).split("\t")[0]?.trim();
    expect(remoteHead).toBe(initialRemoteHead);
    expect(await gitText(root, ["ls-remote", remote, `refs/tags/${RELEASE_TAG}`])).toBe("");
    expect(await orchestrator.rollback()).toBe(false);
    expect(await gitText(root, ["tag", "--list", RELEASE_TAG])).toBe(RELEASE_TAG);
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
  });

  test("pushRelease pushes only the exact tags recorded by a publish-only release", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);

    await Bun.$`git tag unrelated-local`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.initializeExternalRelease([pkg], [stone], true);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);
    await orchestrator.pushRelease();

    const remoteRefs = await gitText(root, ["ls-remote", remote, "refs/tags/*"]);
    expect(remoteRefs).toContain(`refs/tags/${RELEASE_TAG}`);
    expect(remoteRefs).not.toContain("refs/tags/unrelated-local");
  });

  test("rejects a publish-only release whose checkout diverges from the release commit", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.initializeExternalRelease([pkg], [stone], true);
    await orchestrator.createGitTags([pkg]);
    writeFileSync(join(root, "unrelated.txt"), "soft reset leftover\n");
    await Bun.$`git add unrelated.txt`.quiet();

    await expect(orchestrator.finalizeExternalRelease([pkg], [stone])).rejects.toThrow(
      "Repository source files changed after the release commit",
    );

    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("completes a clean publish-only tags release with checkout validation end-to-end", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);

    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    const pkg = makePackage();
    const stone = makePendingStone();
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    await orchestrator.initializeExternalRelease([pkg], [stone], true);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);
    await orchestrator.pushRelease();
    await orchestrator.completeRelease();

    expect((await gitText(root, ["ls-remote", remote, `refs/tags/${RELEASE_TAG}`])).startsWith(head)).toBe(true);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });

  test("creates lightweight release tags even when tag signing is enabled", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    await Bun.$`git config tag.gpgSign true`.quiet();

    const orchestrator = makeOrchestrator(root, { changelog: false });
    await orchestrator.createGitTags([makePackage()]);

    expect(await gitText(root, ["cat-file", "-t", `refs/tags/${RELEASE_TAG}`])).toBe("commit");
  });

  test("pushRelease resolves remote.pushDefault and pushes exact tags from detached HEAD", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);

    await Bun.$`git config remote.pushDefault origin`.quiet();
    await Bun.$`git tag unrelated-local`.quiet();
    await Bun.$`git checkout --detach -q`.quiet();

    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.initializeExternalRelease([pkg], [stone], true);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);
    await orchestrator.pushRelease();

    const remoteRefs = await gitText(root, ["ls-remote", remote, "refs/tags/*"]);
    expect(remoteRefs).toContain(`refs/tags/${RELEASE_TAG}`);
    expect(remoteRefs).not.toContain("refs/tags/unrelated-local");
  });

  test("rejects detached HEAD before crossing the remote push boundary", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);
    const releaseCommit = await gitText(root, ["rev-parse", "HEAD"]);
    await Bun.$`git checkout --detach -q`.quiet();

    await expect(orchestrator.finalizeExternalRelease([pkg], [stone])).rejects.toThrow("detached HEAD");
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
    await expect(orchestrator.rollback()).rejects.toThrow("Cannot roll back release commit because HEAD changed");
    expect(await gitText(root, ["rev-parse", "refs/heads/main"])).toBe(releaseCommit);
    expect(await gitText(root, ["tag", "--list", RELEASE_TAG])).toBe(RELEASE_TAG);
  });

  test("preserves post-commit edits to release-owned files instead of rolling them back", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true, tags: false });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);
    const releaseCommit = await gitText(root, ["rev-parse", "HEAD"]);
    const manifest = JSON.parse(readFileSync(join(root, PACKAGE_FILE), "utf-8"));
    writeFileSync(join(root, PACKAGE_FILE), `${JSON.stringify({ ...manifest, userEdit: true }, null, 2)}\n`);

    await expect(orchestrator.rollback(false)).rejects.toThrow("release-owned files changed after commit creation");

    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(releaseCommit);
    expect(readFileSync(join(root, PACKAGE_FILE), "utf-8")).toContain('"userEdit": true');
    expect(await ReleaseLedger.loadActive(root)).not.toBeNull();
  });

  test("preserves a release tag that moved after creation instead of deleting it", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const baseCommit = await gitText(root, ["rev-parse", "HEAD"]);
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);
    const releaseCommit = await gitText(root, ["rev-parse", "HEAD"]);
    await Bun.$`git tag -f ${RELEASE_TAG} ${baseCommit}`.quiet();

    await expect(orchestrator.rollback(false)).rejects.toThrow(`tag ${RELEASE_TAG} changed after creation`);

    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(releaseCommit);
    expect(await gitText(root, ["rev-parse", `refs/tags/${RELEASE_TAG}`])).toBe(baseCommit);
    expect(await ReleaseLedger.loadActive(root)).not.toBeNull();
  });
});
