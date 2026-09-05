import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ReleaseOrchestrator } from "../../src/services/ReleaseOrchestrator";
import { ReleaseLedger } from "../../src/services/release-ledger";
import {
  type Fixture,
  gitText,
  makeConfig,
  makePackage,
  makePendingStone,
  RELEASE_TAG,
  recordReleaseCommit,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";

describe.each([false, true])("interrupted branch pushes with tags=%s", (tags) => {
  const originalCwd = process.cwd();
  let fixture: Fixture;
  let releaseCommit: string;
  let baseCommit: string;
  let ledger: ReleaseLedger;

  beforeEach(async () => {
    fixture = await setupReleaseFixture(false);
    process.chdir(fixture.root);
    baseCommit = await gitText(fixture.root, ["rev-parse", "HEAD"]);
    await Bun.$`git commit -q --allow-empty -m release`.quiet();
    releaseCommit = await gitText(fixture.root, ["rev-parse", "HEAD"]);
    ledger = await ReleaseLedger.create({
      options: {
        changelog: false,
        createRelease: false,
        dryRun: false,
        npm: false,
        npmTag: "latest",
        publishOnly: true,
        push: true,
        tags,
      },
      packages: [makePackage()],
      stones: [makePendingStone()],
    });
    await recordReleaseCommit(ledger, fixture.root, releaseCommit);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(fixture.remote).href }, [
      { destination: "refs/heads/main", oid: releaseCommit, source: "refs/heads/main" },
      ...(tags
        ? [{ destination: `refs/tags/${RELEASE_TAG}`, oid: releaseCommit, source: `refs/tags/${RELEASE_TAG}` }]
        : []),
    ]);
    await ledger.setPhase("local-ready");
    await ledger.markPush("started");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(fixture.root, { force: true, recursive: true });
    rmSync(fixture.remote, { force: true, recursive: true });
  });

  test("retries an interrupted push while the remote remains at an ancestor", async () => {
    await ReleaseOrchestrator.resume(makeConfig(fixture.root));

    expect(await gitText(fixture.root, ["ls-remote", fixture.remote, "refs/heads/main"])).toContain(releaseCommit);
    expect(await ReleaseLedger.loadActive()).toBeNull();
  });

  test("retries a push whose remote branch was never created", async () => {
    await Bun.$`git --git-dir ${fixture.remote} update-ref -d refs/heads/main`.quiet();

    await ReleaseOrchestrator.resume(makeConfig(fixture.root));

    expect(await gitText(fixture.root, ["ls-remote", fixture.remote, "refs/heads/main"])).toContain(releaseCommit);
    expect(await ReleaseLedger.loadActive()).toBeNull();
  });

  test("recognises a successful push after another checkout advances the remote branch", async () => {
    await Bun.$`git push origin HEAD`.quiet();
    const other = join(fixture.root, ".git/other-checkout");
    await Bun.$`git clone -q --branch main ${fixture.remote} ${other}`.quiet();
    await Bun.$`git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false commit --allow-empty -qm next`
      .cwd(other)
      .quiet();
    await Bun.$`git push origin HEAD`.cwd(other).quiet();
    const advanced = await gitText(other, ["rev-parse", "HEAD"]);

    await ReleaseOrchestrator.resume(makeConfig(fixture.root));

    expect(await gitText(fixture.root, ["ls-remote", fixture.remote, "refs/heads/main"])).toContain(advanced);
    expect(await gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(releaseCommit);
    expect(await ReleaseLedger.loadActive()).toBeNull();
  });

  test("preserves a divergent remote branch and keeps the recovery ledger", async () => {
    const other = join(fixture.root, ".git/other-checkout");
    await Bun.$`git clone -q --branch main ${fixture.remote} ${other}`.quiet();
    expect(await gitText(other, ["rev-parse", "HEAD"])).toBe(baseCommit);
    await Bun.$`git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false commit --allow-empty -qm divergent`
      .cwd(other)
      .quiet();
    await Bun.$`git push origin HEAD`.cwd(other).quiet();
    const divergent = await gitText(other, ["rev-parse", "HEAD"]);

    await expect(ReleaseOrchestrator.resume(makeConfig(fixture.root))).rejects.toThrow(
      "Cannot safely resume remote push",
    );

    expect(await gitText(fixture.root, ["ls-remote", fixture.remote, "refs/heads/main"])).toContain(divergent);
    expect((await ReleaseLedger.loadActive())?.data.operations.push?.state).toBe("started");
  });

  test.skipIf(!tags)("preserves a conflicting remote tag without pushing the pending branch", async () => {
    await Bun.$`git --git-dir ${fixture.remote} update-ref ${`refs/tags/${RELEASE_TAG}`} ${baseCommit}`.quiet();

    await expect(ReleaseOrchestrator.resume(makeConfig(fixture.root))).rejects.toThrow(
      "Cannot safely resume remote push",
    );

    expect(await gitText(fixture.root, ["ls-remote", fixture.remote, "refs/heads/main"])).toContain(baseCommit);
    expect(await gitText(fixture.root, ["ls-remote", fixture.remote, `refs/tags/${RELEASE_TAG}`])).toContain(
      baseCommit,
    );
    expect((await ReleaseLedger.loadActive())?.data.operations.push?.state).toBe("started");
  });
});
