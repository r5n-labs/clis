import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { BumpType } from "../../src/domain/BumpType";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import { type ReleaseOptions, ReleaseOrchestrator } from "../../src/services/ReleaseOrchestrator";
import type { SisyphusConfig } from "../../src/types";

const PACKAGE_NAME = "@fixture/foo";
const PACKAGE_FILE = "packages/foo/package.json";
const CHANGELOG_FILE = "packages/foo/CHANGELOG.md";
const STONE_FILE = ".sisyphus/stones/0001-testtest.json";
const RELEASE_TAG = "@fixture/foo@1.0.1";

const BASE_OPTIONS: ReleaseOptions = {
  changelog: true,
  createRelease: false,
  dryRun: false,
  npm: false,
  push: false,
  tags: true,
};

type Fixture = { root: string; remote: string };

async function setupReleaseFixture(withChangelog: boolean): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "sisyphus-roll-"));
  const remote = mkdtempSync(join(tmpdir(), "sisyphus-remote-"));

  mkdirSync(join(root, "packages/foo"), { recursive: true });
  writeFileSync(
    join(root, PACKAGE_FILE),
    `${JSON.stringify({ name: PACKAGE_NAME, private: true, version: "1.0.0" }, null, 2)}\n`,
  );
  if (withChangelog) writeFileSync(join(root, CHANGELOG_FILE), "# Changelog\n");

  mkdirSync(join(root, ".sisyphus/stones"), { recursive: true });
  const config = { commit: { author: "Sisyphus Test", email: "sisyphus@test.local" } };
  writeFileSync(join(root, ".sisyphus/config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(
    join(root, STONE_FILE),
    `${JSON.stringify({ id: "0001-testtest", message: "pending", patch: [PACKAGE_NAME] })}\n`,
  );
  writeFileSync(join(root, "unrelated.txt"), "original\n");

  await Bun.$`git init -q -b main`.cwd(root).quiet();
  await Bun.$`git config user.email sisyphus@test.local`.cwd(root).quiet();
  await Bun.$`git config user.name "Sisyphus Test"`.cwd(root).quiet();
  await Bun.$`git config commit.gpgsign false`.cwd(root).quiet();
  await Bun.$`git config tag.gpgSign false`.cwd(root).quiet();
  await Bun.$`git config core.hooksPath ${join(root, ".git/no-hooks")}`.cwd(root).quiet();
  await Bun.$`git add -A`.cwd(root).quiet();
  await Bun.$`git commit -q -m init`.cwd(root).quiet();

  await Bun.$`git init -q --bare`.cwd(remote).quiet();
  await Bun.$`git remote add origin ${remote}`.cwd(root).quiet();
  await Bun.$`git push -q -u origin main`.cwd(root).quiet();

  return { remote, root };
}

function makeOrchestrator(root: string, options: Partial<ReleaseOptions> = {}): ReleaseOrchestrator {
  const config = new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), SISYPHUS_DEFAULT_CONFIG);
  return new ReleaseOrchestrator(config, { ...BASE_OPTIONS, ...options });
}

function makePackage(): Package {
  return new Package({ bump: BumpType.Patch, file: PACKAGE_FILE, name: PACKAGE_NAME, version: "1.0.0" });
}

async function gitText(root: string, args: string[]): Promise<string> {
  const result = await Bun.$`git ${args}`.cwd(root).quiet();
  return result.stdout.toString().trim();
}

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

  test("tags the release commit (not pre-bump HEAD) and pushes branch + tags", async () => {
    fixture = await setupReleaseFixture(true);
    const { root, remote } = fixture;
    process.chdir(root);

    const orchestrator = makeOrchestrator(root, { push: true });
    const pkg = makePackage();
    const stone = Stone.create({ message: "ship it", patch: [PACKAGE_NAME] });
    const initialHead = await gitText(root, ["rev-parse", "HEAD"]);

    await orchestrator.preflight([pkg]);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));

    await orchestrator.createCommit(stone, [pkg]);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.pushToRemote();

    const head = await gitText(root, ["rev-parse", "HEAD"]);
    expect(head).not.toBe(initialHead);
    expect(await gitText(root, ["log", "-1", "--pretty=%s"])).toBe("chore(release): ship it");

    const tagTarget = await gitText(root, ["rev-list", "-n", "1", RELEASE_TAG]);
    expect(tagTarget).toBe(head);

    const remoteRefs = await gitText(root, ["ls-remote", remote]);
    const mainRef = remoteRefs.split("\n").find((line) => line.endsWith("refs/heads/main"));
    const tagRef = remoteRefs.split("\n").find((line) => line.endsWith(`refs/tags/${RELEASE_TAG}`));
    expect(mainRef?.startsWith(head)).toBe(true);
    expect(tagRef?.startsWith(head)).toBe(true);
  });

  test("stages only release files - unrelated changes stay out of the commit", async () => {
    fixture = await setupReleaseFixture(true);
    const { root } = fixture;
    process.chdir(root);

    const orchestrator = makeOrchestrator(root);
    const pkg = makePackage();
    const stone = Stone.create({ message: "ship it", patch: [PACKAGE_NAME] });

    await orchestrator.preflight([pkg]);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));
    writeFileSync(join(root, "unrelated.txt"), "drive-by change\n");
    writeFileSync(join(root, "junk.txt"), "untracked\n");

    await orchestrator.createCommit(stone, [pkg]);

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
    expect(status).toContain("M unrelated.txt");
    expect(status).toContain("?? junk.txt");
  });

  test("createCommit succeeds without changelog files when changelog generation is off", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const orchestrator = makeOrchestrator(root, { changelog: false });
    const pkg = makePackage();
    const stone = Stone.create({ message: "ship it", patch: [PACKAGE_NAME] });

    await orchestrator.preflight([pkg]);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));

    await orchestrator.createCommit(stone, [pkg]);

    const committedPaths = (await gitText(root, ["show", "--name-only", "--pretty=format:", "HEAD"]))
      .split("\n")
      .filter(Boolean);
    expect(committedPaths).toContain(PACKAGE_FILE);
    expect(committedPaths).toContain(STONE_FILE);
    expect(await gitText(root, ["log", "-1", "--pretty=%s"])).toBe("chore(release): ship it");
  });
});
