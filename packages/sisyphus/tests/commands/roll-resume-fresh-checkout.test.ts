import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RollCommand } from "../../src/commands/roll";
import { ReleaseLedger } from "../../src/services/release-ledger";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../helpers/npm-registry";
import {
  type Fixture,
  gitText,
  makeConfig,
  makePublishPackage,
  PACKAGE_NAME,
  RELEASE_TAG,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";
import { makeCtx } from "../helpers/roll";

const CLI_PATH = join(import.meta.dir, "../../src/cli.ts");
const HTTP_SERVER_ERROR = 500;
const RELEASED_VERSION = "1.0.1";
const PUSHED_NPM_RELEASE = { changelog: false, createRelease: false, npm: true, push: true, tags: true };

async function runCli(cwd: string, args: string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd,
    env,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

async function releaseDirectory(root: string): Promise<string> {
  return resolve(root, await gitText(root, ["rev-parse", "--git-path", "sisyphus/release"]));
}

describe("roll --resume from a fresh checkout", () => {
  const originalCwd = process.cwd();
  let fixture: Fixture | undefined;
  let clone: string | undefined;
  let registry: FakeNpmRegistry | undefined;

  afterEach(() => {
    registry?.stop();
    registry = undefined;
    process.chdir(originalCwd);
    for (const path of [fixture?.root, fixture?.remote, clone]) {
      if (path) rmSync(path, { force: true, recursive: true });
    }
    fixture = undefined;
    clone = undefined;
  });

  async function failReleaseAfterPush() {
    fixture = await setupReleaseFixture(false);
    const { remote, root } = fixture;
    process.chdir(root);
    registry = startFakeNpmRegistry(root, (packument) => packument, HTTP_SERVER_ERROR);
    makePublishPackage(root, "packages/foo", PACKAGE_NAME);
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "publish foo"`.quiet();
    await Bun.$`git push -q origin main`.quiet();
    const baseCommit = await gitText(root, ["rev-parse", "HEAD"]);

    await expect(new RollCommand().execute(makeCtx(makeConfig(root), PUSHED_NPM_RELEASE))).rejects.toThrow(
      "Release incomplete after remote push began",
    );
    const releaseCommit = await gitText(root, ["rev-parse", "HEAD"]);
    const remoteRefs = await gitText(remote, ["for-each-ref", "--format=%(refname) %(objectname)"]);
    expect(remoteRefs.split("\n")).toEqual([
      `refs/heads/main ${releaseCommit}`,
      `refs/tags/${RELEASE_TAG} ${releaseCommit}`,
    ]);
    expect(await gitText(remote, ["rev-parse", `${releaseCommit}^`])).toBe(baseCommit);
    expect(registry.published).toEqual([PACKAGE_NAME]);

    const checkout = mkdtempSync(join(tmpdir(), "sisyphus-rerun-"));
    clone = checkout;
    await Bun.$`git clone -q ${remote} ${checkout}`.quiet();
    await Bun.$`git checkout -q --detach ${baseCommit}`.cwd(checkout).quiet();
    cpSync(await releaseDirectory(root), await releaseDirectory(checkout), { recursive: true });
    const userConfig = join(checkout, ".git/npmrc-test");
    copyFileSync(join(root, ".git/npmrc-test"), userConfig);
    process.chdir(checkout);
    rmSync(root, { force: true, recursive: true });

    const resume = () =>
      runCli(checkout, ["roll", "--resume", "--json"], { ...process.env, NPM_CONFIG_USERCONFIG: userConfig });
    return { baseCommit, checkout, releaseCommit, remote, remoteRefs, resume };
  }

  test("completes a pushed release with only the restored ledger and publishes it once", async () => {
    const { checkout, releaseCommit, remote, remoteRefs, resume } = await failReleaseAfterPush();

    const result = await resume();

    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: expect.any(String) });
    const report = JSON.parse(result.stdout);
    expect(report.mode).toBe("resume");
    expect(report.status).toBe("completed");
    expect(report.publishedPackages).toEqual([{ name: PACKAGE_NAME, version: RELEASED_VERSION }]);
    expect(registry?.published).toEqual([PACKAGE_NAME]);
    expect(await ReleaseLedger.loadActive(checkout)).toBeNull();
    expect(existsSync(join(await releaseDirectory(checkout), "history", `${report.releaseId}.json`))).toBe(true);
    expect(await gitText(remote, ["for-each-ref", "--format=%(refname) %(objectname)"])).toBe(remoteRefs);
    expect(await gitText(checkout, ["tag", "--points-at", releaseCommit])).toBe(RELEASE_TAG);
  });

  test("leaves a modified base checkout in place and stops before any external operation", async () => {
    const { baseCommit, checkout, releaseCommit, resume } = await failReleaseAfterPush();
    writeFileSync(join(checkout, "unrelated.txt"), "local change\n");

    const result = await resume();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Check out ${releaseCommit} before resuming`);
    expect(await gitText(checkout, ["rev-parse", "HEAD"])).toBe(baseCommit);
    expect(readFileSync(join(checkout, "unrelated.txt"), "utf-8")).toBe("local change\n");
    expect(registry?.published).toEqual([PACKAGE_NAME]);
    expect((await ReleaseLedger.loadActive(checkout))?.data.operations.npm[PACKAGE_NAME]?.state).toBe("started");
  });
});
