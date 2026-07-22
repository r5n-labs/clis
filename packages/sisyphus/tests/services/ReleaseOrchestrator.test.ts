import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigManager } from "@r5n/cli-core";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { BumpType } from "../../src/domain/BumpType";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import { ReleaseLedger } from "../../src/services/ReleaseLedger";
import { isValidNpmTag, type ReleaseOptions, ReleaseOrchestrator } from "../../src/services/ReleaseOrchestrator";
import { StoneManager } from "../../src/services/StoneManager";
import type { SisyphusConfig } from "../../src/types";

const PACKAGE_NAME = "@fixture/foo";
const PACKAGE_FILE = "packages/foo/package.json";
const CHANGELOG_FILE = "packages/foo/CHANGELOG.md";
const STONE_FILE = ".sisyphus/stones/0001-testtest.json";
const RELEASE_TAG = "@fixture/foo@1.0.1";
const PUBLISH_SCRIPT = join(import.meta.dir, "../../../../tools/scripts/publish-package.ts");

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
    join(root, "package.json"),
    `${JSON.stringify({ name: "release-fixture", private: true, workspaces: ["packages/*"] }, null, 2)}\n`,
  );
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

function makeConfig(root: string): ConfigManager<SisyphusConfig> {
  return new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), SISYPHUS_DEFAULT_CONFIG);
}

function makeOrchestrator(root: string, options: Partial<ReleaseOptions> = {}): ReleaseOrchestrator {
  return new ReleaseOrchestrator(makeConfig(root), { ...BASE_OPTIONS, ...options });
}

function makePackage(): Package {
  return new Package({ bump: BumpType.Patch, file: PACKAGE_FILE, name: PACKAGE_NAME, version: "1.0.0" });
}

function makePendingStone(): Stone {
  return Stone.fromJson({ id: "0001-testtest", message: "ship it", patch: [PACKAGE_NAME] });
}

type PublishPackageOptions = { identityChanges?: boolean; preparationFails?: boolean; private?: boolean };

function makePublishPackage(
  root: string,
  directory: string,
  name: string,
  options: PublishPackageOptions = {},
): Package {
  const file = join(directory, "package.json");
  const prepareScript = [
    'const countFile = Bun.file("build-count.txt");',
    "const count = (await countFile.exists()) ? Number(await countFile.text()) : 0;",
    "await Bun.write(countFile, String(count + 1));",
    'const manifestFile = Bun.file("package.json");',
    "const manifest = await manifestFile.json();",
    `await Bun.write(manifestFile, JSON.stringify({ ...manifest, ${options.identityChanges ? 'name: "@fixture/wrong"' : "prepared: true"} }, null, 2) + "\\n");`,
    options.preparationFails ? "process.exit(1);" : "",
  ].join("\n");

  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, "prepare.ts"), `${prepareScript}\n`);
  writeFileSync(
    join(root, file),
    `${JSON.stringify(
      {
        name,
        private: options.private ?? false,
        scripts: {
          build: "bun prepare.ts",
          "package:prepare": "bun prepare.ts",
          "package:publish": `bun ${PUBLISH_SCRIPT} .`,
        },
        version: "1.0.0",
      },
      null,
      2,
    )}\n`,
  );

  return new Package({ file, name, version: "1.0.0" });
}

async function gitText(root: string, args: string[]): Promise<string> {
  const result = await Bun.$`git ${args}`.cwd(root).quiet();
  return result.stdout.toString().trim();
}

describe("ReleaseOrchestrator release flow", () => {
  const originalCwd = process.cwd();
  const originalRegistry = process.env.BUN_CONFIG_REGISTRY;
  const originalToken = process.env.BUN_CONFIG_TOKEN;
  const originalNpmRegistry = process.env.NPM_CONFIG_REGISTRY;
  const originalProvenance = process.env.NPM_CONFIG_PROVENANCE;
  const originalFetchRetries = process.env.NPM_CONFIG_FETCH_RETRIES;
  const originalUserConfig = process.env.NPM_CONFIG_USERCONFIG;
  let fixture: Fixture | undefined;
  let registry: ReturnType<typeof Bun.serve> | undefined;

  function startRegistry(failingPackage?: string): string[] {
    const requests: string[] = [];
    registry = Bun.serve({
      port: 0,
      async fetch(request) {
        const packageName = decodeURIComponent(new URL(request.url).pathname.slice(1));
        if (request.method === "GET") return Response.json({ error: "not found" }, { status: 404 });
        requests.push(packageName);
        await request.arrayBuffer();
        return Response.json(
          { ok: packageName !== failingPackage },
          { status: packageName === failingPackage ? 500 : 201 },
        );
      },
    });
    process.env.BUN_CONFIG_REGISTRY = String(registry.url);
    process.env.BUN_CONFIG_TOKEN = crypto.randomUUID();
    process.env.NPM_CONFIG_REGISTRY = String(registry.url);
    process.env.NPM_CONFIG_PROVENANCE = "false";
    process.env.NPM_CONFIG_FETCH_RETRIES = "0";
    if (fixture) {
      const registryUrl = new URL(registry.url);
      const userConfig = join(fixture.root, ".git/npmrc-test");
      writeFileSync(userConfig, `registry=${registry.url}\n//${registryUrl.host}/:_authToken=test-token\n`);
      process.env.NPM_CONFIG_USERCONFIG = userConfig;
    }
    return requests;
  }

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
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));

    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.pushToRemote();

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

    const orchestrator = makeOrchestrator(root);
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));

    await expect(orchestrator.createCommit(stone, [pkg], [stone])).rejects.toThrow("Failed to create commit");

    const stagedPaths = (await gitText(root, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
    expect(stagedPaths).toEqual(["unrelated.txt"]);
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
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);

    await expect(orchestrator.pushToRemote()).rejects.toThrow("Failed to atomically push release refs");

    const remoteHead = (await gitText(root, ["ls-remote", remote, "refs/heads/main"])).split("\t")[0]?.trim();
    expect(remoteHead).toBe(initialRemoteHead);
    expect(await gitText(root, ["ls-remote", remote, `refs/tags/${RELEASE_TAG}`])).toBe("");
    expect(await orchestrator.rollback()).toBe(false);
    expect(await gitText(root, ["tag", "--list", RELEASE_TAG])).toBe(RELEASE_TAG);
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
  });

  test("pushTags pushes only the exact tags created by the release", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);

    await Bun.$`git tag unrelated-local`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    await orchestrator.createGitTags([makePackage()]);
    await orchestrator.pushTags();

    const remoteRefs = await gitText(root, ["ls-remote", remote, "refs/tags/*"]);
    expect(remoteRefs).toContain(`refs/tags/${RELEASE_TAG}`);
    expect(remoteRefs).not.toContain("refs/tags/unrelated-local");
  });

  test("pushTags resolves remote.pushDefault and pushes exact tags from detached HEAD", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);

    await Bun.$`git config remote.pushDefault origin`.quiet();
    await Bun.$`git tag unrelated-local`.quiet();
    await Bun.$`git checkout --detach -q`.quiet();

    const orchestrator = makeOrchestrator(root, { changelog: false, push: true });
    await orchestrator.createGitTags([makePackage()]);
    await orchestrator.pushTags();

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
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);
    await Bun.$`git checkout --detach -q`.quiet();

    await expect(orchestrator.pushToRemote()).rejects.toThrow("detached HEAD");
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
    expect(await orchestrator.rollback()).toBe(true);
    expect(await gitText(root, ["tag", "--list", RELEASE_TAG])).toBe("");
  });

  test("skips private packages and publishes prepared public package artifacts", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();

    const privatePackage = makePublishPackage(root, "packages/private", "@fixture/private", { private: true });
    const publicPackage = makePublishPackage(root, "packages/public", "@fixture/public");
    const originalManifest = readFileSync(join(root, publicPackage.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });

    await orchestrator.publishToNpm([privatePackage, publicPackage]);

    expect(existsSync(join(root, "packages/private/build-count.txt"))).toBe(false);
    expect(readFileSync(join(root, "packages/public/build-count.txt"), "utf-8")).toBe("1");
    expect(readFileSync(join(root, publicPackage.file), "utf-8")).toBe(originalManifest);
    expect(published).toEqual(["@fixture/public"]);
  });

  test("does not cross the npm boundary when all packages are private", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const first = makePublishPackage(root, "packages/private-a", "@fixture/private-a", { private: true });
    const second = makePublishPackage(root, "packages/private-b", "@fixture/private-b", { private: true });
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });

    await orchestrator.publishToNpm([first, second]);

    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
    expect(existsSync(join(root, "packages/private-a/build-count.txt"))).toBe(false);
    expect(existsSync(join(root, "packages/private-b/build-count.txt"))).toBe(false);
    expect(await orchestrator.rollback()).toBe(true);
  });

  test("publishes the immutable prepared artifact when the source manifest changes", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();

    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.prepareNpmPublish([pkg]);

    const manifestPath = join(root, pkg.file);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, private: true }, null, 2)}\n`);

    await orchestrator.publishToNpm([pkg]);

    expect(readFileSync(join(root, "packages/public/build-count.txt"), "utf-8")).toBe("1");
    expect(published).toEqual(["@fixture/public"]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(true);
  });

  test("fails closed on an unreadable package manifest before publication", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const invalidFile = "packages/invalid/package.json";
    mkdirSync(join(root, "packages/invalid"), { recursive: true });
    writeFileSync(join(root, invalidFile), "not json\n");
    const invalidPackage = new Package({ file: invalidFile, name: "@fixture/invalid", version: "1.0.0" });
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });

    await expect(orchestrator.publishToNpm([invalidPackage])).rejects.toThrow("Failed to parse");
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("prepares every public package once before publication and restores manifests on failure", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();

    const first = makePublishPackage(root, "packages/public-a", "@fixture/public-a");
    const second = makePublishPackage(root, "packages/public-b", "@fixture/public-b", { preparationFails: true });
    const firstManifest = readFileSync(join(root, first.file), "utf-8");
    const secondManifest = readFileSync(join(root, second.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });

    await expect(orchestrator.publishToNpm([first, second])).rejects.toThrow("Failed to prepare @fixture/public-b");

    expect(readFileSync(join(root, "packages/public-a/build-count.txt"), "utf-8")).toBe("1");
    expect(readFileSync(join(root, "packages/public-b/build-count.txt"), "utf-8")).toBe("1");
    expect(readFileSync(join(root, first.file), "utf-8")).toBe(firstManifest);
    expect(readFileSync(join(root, second.file), "utf-8")).toBe(secondManifest);
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("rejects and restores a prepared package with the wrong identity before publication", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public", { identityChanges: true });
    const originalManifest = readFileSync(join(root, pkg.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });

    await expect(orchestrator.prepareNpmPublish([pkg])).rejects.toThrow("Packed manifest identity mismatch");

    expect(readFileSync(join(root, pkg.file), "utf-8")).toBe(originalManifest);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("production publish wrapper prepares once and restores its source manifest", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    const published = startRegistry();

    const pkg = makePublishPackage(root, "packages/wrapper", "@fixture/wrapper");
    const manifestPath = join(root, pkg.file);
    const originalManifest = readFileSync(manifestPath, "utf-8");
    const result = await Bun.$`bun ${PUBLISH_SCRIPT} ${dirname(manifestPath)} --dry-run`.quiet().nothrow();

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(dirname(manifestPath), "build-count.txt"), "utf-8")).toBe("1");
    expect(readFileSync(manifestPath, "utf-8")).toBe(originalManifest);
    expect(published).toEqual([]);
  });

  test("preserves local release state when a later npm publication fails", async () => {
    fixture = await setupReleaseFixture(true);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry("@fixture/public-b");

    const orchestrator = makeOrchestrator(root, { npm: true });
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);
    const releaseHead = await gitText(root, ["rev-parse", "HEAD"]);

    const first = makePublishPackage(root, "packages/public-a", "@fixture/public-a");
    const second = makePublishPackage(root, "packages/public-b", "@fixture/public-b");

    await expect(orchestrator.publishToNpm([first, second])).rejects.toThrow("Failed to publish @fixture/public-b");

    expect(readFileSync(join(root, "packages/public-a/build-count.txt"), "utf-8")).toBe("1");
    expect(readFileSync(join(root, "packages/public-b/build-count.txt"), "utf-8")).toBe("1");
    expect(published).toEqual(["@fixture/public-a", "@fixture/public-b"]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(true);
    expect(await orchestrator.rollback()).toBe(false);
    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(releaseHead);
    expect(await gitText(root, ["tag", "--list", RELEASE_TAG])).toBe(RELEASE_TAG);
    expect(existsSync(join(root, STONE_FILE))).toBe(false);
    expect(readFileSync(join(root, CHANGELOG_FILE), "utf-8")).toContain("ship it");

    const incomplete = orchestrator.createIncompleteReleaseError(new Error("second publication failed"));
    expect(incomplete.message).toContain("Release incomplete after npm publication began");
    expect(incomplete.hint).toContain("--resume");
  });

  test("resumes a started push by confirming exact remote refs without pushing again", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);
    const pkg = makePackage();
    const stone = makePendingStone();
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    const ledger = await ReleaseLedger.create(
      {
        options: {
          changelog: false,
          createRelease: false,
          dryRun: false,
          npm: false,
          npmTag: "latest",
          publishOnly: false,
          push: true,
          tags: false,
        },
        packages: [pkg],
        stones: [stone],
      },
      root,
    );
    await ledger.setReleaseCommit(head);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(remote).href }, [
      { destination: "refs/heads/main", oid: head, source: "refs/heads/main" },
    ]);
    await ledger.setPhase("local-ready");
    await ledger.markPush("started");

    const result = await ReleaseOrchestrator.resume(makeConfig(root));

    expect(result.packages.map((item) => item.name)).toEqual([PACKAGE_NAME]);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
    expect(await gitText(root, ["ls-remote", remote, "refs/heads/main"])).toContain(head);
  });

  test("recreates missing local release tags at the recorded commit before completing", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    const ledger = await ReleaseLedger.create(
      {
        options: {
          changelog: false,
          createRelease: false,
          dryRun: false,
          npm: false,
          npmTag: "latest",
          publishOnly: false,
          push: false,
          tags: true,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await ledger.setReleaseCommit(head);

    await ReleaseOrchestrator.resume(makeConfig(root));

    expect(await gitText(root, ["rev-parse", `refs/tags/${RELEASE_TAG}`])).toBe(head);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });

  test("refuses to reconcile a push after its remote destination changes", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    const replacementRemote = join(root, ".git/replacement.git");
    process.chdir(root);
    await Bun.$`git init -q --bare ${replacementRemote}`.quiet();
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    const ledger = await ReleaseLedger.create(
      {
        options: {
          changelog: false,
          createRelease: false,
          dryRun: false,
          npm: false,
          npmTag: "latest",
          publishOnly: false,
          push: true,
          tags: false,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await ledger.setReleaseCommit(head);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(remote).href }, [
      { destination: "refs/heads/main", oid: head, source: "refs/heads/main" },
    ]);
    await ledger.setPhase("local-ready");
    await ledger.markPush("started");
    await Bun.$`git remote set-url origin ${replacementRemote}`.quiet();

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow(
      "Release incomplete after an external release operation began",
    );

    expect(await gitText(root, ["ls-remote", replacementRemote, "refs/heads/main"])).toBe("");
  });

  test("reconciles against the sole push URL instead of the remote fetch URL", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote: fetchRemote } = fixture;
    const pushRemote = join(root, ".git/push.git");
    process.chdir(root);
    await Bun.$`git init -q --bare ${pushRemote}`.quiet();
    await Bun.$`git remote set-url --push origin ${pushRemote}`.quiet();
    writeFileSync(join(root, "push-only.txt"), "push destination\n");
    await Bun.$`git add push-only.txt`.quiet();
    await Bun.$`git commit -q -m "push destination commit"`.quiet();
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    const ledger = await ReleaseLedger.create(
      {
        options: {
          changelog: false,
          createRelease: false,
          dryRun: false,
          npm: false,
          npmTag: "latest",
          publishOnly: false,
          push: true,
          tags: false,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await ledger.setReleaseCommit(head);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(pushRemote).href }, [
      { destination: "refs/heads/main", oid: head, source: "refs/heads/main" },
    ]);
    await ledger.setPhase("local-ready");
    await ledger.markPush("started");
    await Bun.$`git push ${pushRemote} ${`${head}:refs/heads/main`}`.quiet();

    await ReleaseOrchestrator.resume(makeConfig(root));

    expect(await gitText(root, ["ls-remote", pushRemote, "refs/heads/main"])).toContain(head);
    expect(await gitText(root, ["ls-remote", fetchRemote, "refs/heads/main"])).not.toContain(head);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });

  test("rejects multiple push URLs before crossing the remote boundary", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    const secondRemote = join(root, ".git/second-push.git");
    process.chdir(root);
    await Bun.$`git init -q --bare ${secondRemote}`.quiet();
    await Bun.$`git remote set-url --add --push origin ${remote}`.quiet();
    await Bun.$`git remote set-url --add --push origin ${secondRemote}`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true, tags: false });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.initializeExternalRelease([pkg], [stone], false);

    await expect(orchestrator.finalizeExternalRelease([pkg], [stone])).rejects.toThrow(
      "must have exactly one push URL",
    );

    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
    await orchestrator.rollback();
  });

  test("rejects credential-bearing push URLs without persisting them", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const credentialUrl = "https://release-user:release-secret@github.com/fixture/repo.git";
    await Bun.$`git remote set-url --push origin ${credentialUrl}`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true, tags: false });
    const pkg = makePackage();
    const stone = makePendingStone();
    await orchestrator.initializeExternalRelease([pkg], [stone], false);

    await expect(orchestrator.finalizeExternalRelease([pkg], [stone])).rejects.toThrow(
      "Push URL contains embedded credentials",
    );

    const ledger = await ReleaseLedger.loadActive(root);
    expect(JSON.stringify(ledger?.data)).not.toContain("release-secret");
    await orchestrator.rollback();
  });

  test("resumes a started npm publish only when registry integrity matches the durable artifact", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public").withVersions("1.0.0", "1.0.1");
    const artifactSource = join(root, "published.tgz");
    writeFileSync(artifactSource, "published artifact");
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    const ledger = await ReleaseLedger.create(
      {
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
        packages: [pkg],
        stones: [],
      },
      root,
    );
    await ledger.setReleaseCommit(head);
    const artifact = await ledger.setArtifact(pkg.name, artifactSource);

    const methods: string[] = [];
    registry = Bun.serve({
      port: 0,
      fetch(request) {
        methods.push(request.method);
        return Response.json({
          "dist-tags": { latest: "1.0.1" },
          name: pkg.name,
          versions: { "1.0.1": { dist: { integrity: artifact.integrity }, name: pkg.name, version: "1.0.1" } },
        });
      },
    });
    process.env.BUN_CONFIG_REGISTRY = String(registry.url);
    process.env.BUN_CONFIG_TOKEN = crypto.randomUUID();
    process.env.NPM_CONFIG_REGISTRY = String(registry.url);
    process.env.NPM_CONFIG_PROVENANCE = "false";
    await ledger.setNpmRegistry(pkg.name, String(registry.url));
    await ledger.setPhase("local-ready");
    await ledger.markNpm(pkg.name, "started");

    const result = await ReleaseOrchestrator.resume(makeConfig(root));

    expect(result.packages.map((item) => item.name)).toEqual([pkg.name]);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
    expect(existsSync(join(root, "packages/public/build-count.txt"))).toBe(false);
    expect(methods).toEqual(["GET"]);
  });

  test("refuses to build a missing resume artifact from dirty root metadata", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public").withVersions("1.0.0", "1.0.1");
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add public package"`.quiet();
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    const ledger = await ReleaseLedger.create(
      {
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
        packages: [pkg],
        stones: [],
      },
      root,
    );
    await ledger.setReleaseCommit(head);
    await ledger.setNpmRegistry(pkg.name, "https://registry.npmjs.org/");
    const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ ...rootManifest, catalog: { example: "2.0.0" } }, null, 2)}\n`,
    );

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow(
      "Repository source files changed after the release commit",
    );

    const active = await ReleaseLedger.loadActive(root);
    expect(Object.keys(active?.data.artifacts ?? {})).toEqual([]);
    expect(active?.data.operations.npm[pkg.name]?.state).toBe("pending");
  });

  test("pins publishConfig.registry in the durable npm plan", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public").withVersions("1.0.0", "1.0.0");
    const packagePath = join(root, pkg.file);
    const manifest = JSON.parse(readFileSync(packagePath, "utf-8"));
    writeFileSync(
      packagePath,
      `${JSON.stringify({ ...manifest, publishConfig: { registry: "https://npm.pkg.github.com" } }, null, 2)}\n`,
    );
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add registry package"`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });

    await orchestrator.initializeExternalRelease([pkg], [], false);
    await orchestrator.finalizeExternalRelease([pkg], []);

    const ledger = await ReleaseLedger.loadActive(root);
    expect(ledger?.data.operations.npmRegistries[pkg.name]).toBe("https://npm.pkg.github.com/");
    await orchestrator.rollback();
  });

  test("forces the recorded registry when scoped npm configuration later changes", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const recordedRequests = startRegistry();
    if (!registry) throw new Error("Expected registry server");
    const recordedRegistry = String(registry.url);
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public").withVersions("1.0.0", "1.0.0");
    const packagePath = join(root, pkg.file);
    const manifest = JSON.parse(readFileSync(packagePath, "utf-8"));
    writeFileSync(
      packagePath,
      `${JSON.stringify({ ...manifest, publishConfig: { registry: recordedRegistry } }, null, 2)}\n`,
    );
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add scoped registry package"`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], false);
    await orchestrator.finalizeExternalRelease([pkg], []);

    const unexpectedRequests: string[] = [];
    const unexpectedRegistry = Bun.serve({
      port: 0,
      async fetch(request) {
        unexpectedRequests.push(`${request.method} ${new URL(request.url).pathname}`);
        await request.arrayBuffer();
        return Response.json({ ok: true }, { status: 201 });
      },
    });
    try {
      const recordedUrl = new URL(recordedRegistry);
      const unexpectedUrl = new URL(unexpectedRegistry.url);
      const userConfig = process.env.NPM_CONFIG_USERCONFIG;
      if (!userConfig) throw new Error("Expected npm user config");
      writeFileSync(
        userConfig,
        [
          `registry=${recordedRegistry}`,
          `@fixture:registry=${unexpectedRegistry.url}`,
          `//${recordedUrl.host}/:_authToken=recorded-token`,
          `//${unexpectedUrl.host}/:_authToken=unexpected-token`,
          "",
        ].join("\n"),
      );

      await orchestrator.prepareNpmPublish([pkg]);
      await orchestrator.publishToNpm([pkg]);

      expect(recordedRequests).toEqual([pkg.name]);
      expect(unexpectedRequests).toEqual([]);
    } finally {
      unexpectedRegistry.stop(true);
    }
  });

  test("pushes the ledger object ID even if a local source tag moves", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);
    const releaseCommit = await gitText(root, ["rev-parse", "HEAD"]);
    writeFileSync(join(root, "later.txt"), "later\n");
    await Bun.$`git add later.txt`.quiet();
    await Bun.$`git commit -q -m later`.quiet();
    const laterCommit = await gitText(root, ["rev-parse", "HEAD"]);
    await Bun.$`git checkout --detach -q ${releaseCommit}`.quiet();
    await Bun.$`git tag moved-tag ${laterCommit}`.quiet();

    const ledger = await ReleaseLedger.create(
      {
        options: {
          changelog: false,
          createRelease: false,
          dryRun: false,
          npm: false,
          npmTag: "latest",
          publishOnly: false,
          push: true,
          tags: true,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await ledger.setReleaseCommit(releaseCommit);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(remote).href }, [
      { destination: "refs/tags/moved-tag", oid: releaseCommit, source: "refs/tags/moved-tag" },
    ]);
    await ledger.setPhase("local-ready");

    await ReleaseOrchestrator.resume(makeConfig(root));

    const remoteTag = (await gitText(root, ["ls-remote", remote, "refs/tags/moved-tag"])).split("\t")[0];
    expect(remoteTag).toBe(releaseCommit);
  });

  test("finalizes a completed active ledger without requiring the original HEAD", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const ledger = await ReleaseLedger.create(
      {
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
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    const completed = { ...ledger.data, phase: "completed" };
    writeFileSync(ledger.activePath, `${JSON.stringify(completed, null, 2)}\n`);
    writeFileSync(join(root, "later.txt"), "later\n");
    await Bun.$`git add later.txt`.quiet();
    await Bun.$`git commit -q -m later`.quiet();

    await ReleaseOrchestrator.resume(makeConfig(root));

    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });
});

describe("isValidNpmTag", () => {
  test("accepts named dist-tags", () => {
    expect(["latest", "next", "beta-1", "release_2026"].every(isValidNpmTag)).toBe(true);
  });

  test("rejects semver versions, partials, wildcards, and invalid characters", () => {
    expect(["1.2.3", "v1", "v1.2", "v1.2.x", "x", "bad tag", "@beta"].some(isValidNpmTag)).toBe(false);
  });
});
