import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { GitProvider } from "../../src/providers";
import { ReleaseOrchestrator } from "../../src/services/ReleaseOrchestrator";
import { ReleaseLedger } from "../../src/services/release-ledger";
import {
  type Fixture,
  gitText,
  makeConfig,
  makeOrchestrator,
  makePackage,
  makePendingStone,
  makePublishPackage,
  makeRootBuildScript,
  PACKAGE_FILE,
  PACKAGE_NAME,
  RELEASE_TAG,
  recordReleaseCommit,
  STONE_FILE,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";

describe("ReleaseOrchestrator release resume", () => {
  const originalCwd = process.cwd();
  const originalRegistry = process.env.BUN_CONFIG_REGISTRY;
  const originalToken = process.env.BUN_CONFIG_TOKEN;
  const originalNpmRegistry = process.env.NPM_CONFIG_REGISTRY;
  const originalProvenance = process.env.NPM_CONFIG_PROVENANCE;
  const originalUserConfig = process.env.NPM_CONFIG_USERCONFIG;
  let fixture: Fixture | undefined;
  let registry: ReturnType<typeof Bun.serve> | undefined;

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
    if (originalUserConfig === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
    else process.env.NPM_CONFIG_USERCONFIG = originalUserConfig;
    process.chdir(originalCwd);
    if (fixture) {
      rmSync(fixture.root, { force: true, recursive: true });
      rmSync(fixture.remote, { force: true, recursive: true });
    }
    fixture = undefined;
  });

  test("recovers the exact release commit tree after commit recording is interrupted", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);
    const pkg = makePackage();
    const stone = makePendingStone();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true, tags: false });

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    const releaseCommit = await gitText(root, ["rev-parse", "HEAD"]);
    const releaseTree = await gitText(root, ["rev-parse", "HEAD^{tree}"]);
    const interrupted = await ReleaseLedger.loadActive(root);

    expect(interrupted?.data.expectedReleaseTree).toBe(releaseTree);
    expect(interrupted?.data.releaseCommit).toBeUndefined();

    await ReleaseOrchestrator.resume(makeConfig(root));

    const remoteHead = (await gitText(root, ["ls-remote", remote, "refs/heads/main"])).split("\t")[0]?.trim();
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
    expect(remoteHead).toBe(releaseCommit);
  });

  test("rejects an amended release commit with an unrelated tracked change during recovery", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);
    const pkg = makePackage();
    const stone = makePendingStone();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true, tags: false });
    const baseCommit = await gitText(root, ["rev-parse", "HEAD"]);

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    writeFileSync(join(root, "unrelated.txt"), "amended unrelated change\n");
    await Bun.$`git add unrelated.txt`.quiet();
    await Bun.$`git commit -q --amend --no-edit`.quiet();

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow("Release commit tree for release");

    const active = await ReleaseLedger.loadActive(root);
    const remoteHead = (await gitText(root, ["ls-remote", remote, "refs/heads/main"])).split("\t")[0]?.trim();
    expect(active?.data.releaseCommit).toBeUndefined();
    expect(active?.data.operations.push).toBeUndefined();
    expect(remoteHead).toBe(baseCommit);
  });

  test("rejects an amended release commit with changed owned metadata during recovery", async () => {
    fixture = await setupReleaseFixture(false);
    const { root, remote } = fixture;
    process.chdir(root);
    const pkg = makePackage();
    const stone = makePendingStone();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true, tags: false });
    const baseCommit = await gitText(root, ["rev-parse", "HEAD"]);

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    const manifest = JSON.parse(readFileSync(join(root, PACKAGE_FILE), "utf-8"));
    writeFileSync(join(root, PACKAGE_FILE), `${JSON.stringify({ ...manifest, unexpected: true }, null, 2)}\n`);
    await Bun.$`git add ${PACKAGE_FILE}`.quiet();
    await Bun.$`git commit -q --amend --no-edit`.quiet();

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow("Release commit tree for release");

    const active = await ReleaseLedger.loadActive(root);
    const remoteHead = (await gitText(root, ["ls-remote", remote, "refs/heads/main"])).split("\t")[0]?.trim();
    expect(active?.data.releaseCommit).toBeUndefined();
    expect(active?.data.operations.push).toBeUndefined();
    expect(remoteHead).toBe(baseCommit);
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
          publishOnly: true,
          push: true,
          tags: false,
        },
        packages: [pkg],
        stones: [stone],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
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

  test("resumes a started push by pushing when the remote has none of the planned refs", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const emptyRemote = join(root, ".git/empty-remote.git");
    await Bun.$`git init -q --bare ${emptyRemote}`.quiet();
    await Bun.$`git remote set-url origin ${emptyRemote}`.quiet();
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    const ledger = await ReleaseLedger.create(
      {
        options: {
          changelog: false,
          createRelease: false,
          dryRun: false,
          npm: false,
          npmTag: "latest",
          publishOnly: true,
          push: true,
          tags: false,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(emptyRemote).href }, [
      { destination: "refs/heads/main", oid: head, source: "refs/heads/main" },
      { destination: `refs/tags/${RELEASE_TAG}`, oid: head, source: `refs/tags/${RELEASE_TAG}` },
    ]);
    await ledger.setPhase("local-ready");
    await ledger.markPush("started");

    await ReleaseOrchestrator.resume(makeConfig(root));

    expect((await gitText(root, ["ls-remote", emptyRemote, "refs/heads/main"])).startsWith(head)).toBe(true);
    expect((await gitText(root, ["ls-remote", emptyRemote, `refs/tags/${RELEASE_TAG}`])).startsWith(head)).toBe(true);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });

  test("creates provider releases after the remote branch advances past the pushed release commit", async () => {
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
          createRelease: true,
          dryRun: false,
          npm: false,
          npmTag: "latest",
          publishOnly: true,
          push: true,
          tags: true,
        },
        packages: [pkg],
        stones: [stone],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(remote).href }, [
      { destination: "refs/heads/main", oid: head, source: "refs/heads/main" },
      { destination: `refs/tags/${RELEASE_TAG}`, oid: head, source: `refs/tags/${RELEASE_TAG}` },
    ]);
    await ledger.configureProviderRelease(pkg.name, { notes: "notes", tag: RELEASE_TAG, title: "title" });
    await ledger.setPhase("local-ready");
    await ledger.markPush("started");
    await Bun.$`git push -q ${remote} ${`${head}:refs/tags/${RELEASE_TAG}`}`.quiet();
    await ledger.markPush("completed");
    const advanced = await gitText(root, ["commit-tree", `${head}^{tree}`, "-p", head, "-m", "advance"]);
    await Bun.$`git push -q ${remote} ${`${advanced}:refs/heads/main`}`.quiet();

    const releasedTags: string[] = [];
    const orchestrator = makeOrchestrator(root, { changelog: false, createRelease: true, push: true });
    const internals = orchestrator as unknown as {
      commitUrlFn: ((hash: string) => string) | null;
      ledger: ReleaseLedger | null;
      provider: GitProvider | null;
    };
    internals.ledger = ledger;
    internals.commitUrlFn = (hash: string) => `https://example.invalid/commit/${hash}`;
    internals.provider = {
      createRelease: async (release: { tag: string }) => {
        releasedTags.push(release.tag);
      },
    } as unknown as GitProvider;

    await orchestrator.createGitRelease([stone], [pkg]);

    expect(releasedTags).toEqual([RELEASE_TAG]);
    expect(ledger.data.operations.providerReleases[pkg.name]?.state).toBe("completed");
  });

  test("recreates missing local release tags at the recorded commit before completing", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const baseCommit = await gitText(root, ["rev-parse", "HEAD"]);
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
    await ledger.setExpectedReleaseTree(await gitText(root, ["rev-parse", `${baseCommit}^{tree}`]));
    await Bun.$`git commit -q --allow-empty -m "release commit"`.quiet();
    const head = await gitText(root, ["rev-parse", "HEAD"]);
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
          publishOnly: true,
          push: true,
          tags: false,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(remote).href }, [
      { destination: "refs/heads/main", oid: head, source: "refs/heads/main" },
    ]);
    await ledger.setPhase("local-ready");
    await ledger.markPush("started");
    await Bun.$`git remote set-url origin ${replacementRemote}`.quiet();

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow(
      "no longer matches the recorded release destination",
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
          publishOnly: true,
          push: true,
          tags: false,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
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
    await orchestrator.initializeExternalRelease([pkg], [stone], true);

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
    await orchestrator.initializeExternalRelease([pkg], [stone], true);

    await expect(orchestrator.finalizeExternalRelease([pkg], [stone])).rejects.toThrow(
      "Push URL contains embedded credentials",
    );

    const ledger = await ReleaseLedger.loadActive(root);
    expect(JSON.stringify(ledger?.data)).not.toContain("release-secret");
    await orchestrator.rollback();
  });

  test("accepts a credential-free GitHub remote with checkout-managed authentication", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const remoteUrl = "https://github.com/fixture/repo.git";
    await Bun.$`git remote set-url --push origin ${remoteUrl}`.quiet();
    await Bun.$`git config http.https://github.com/.extraheader checkout-managed-auth`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true, tags: false });
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);

    const ledger = await ReleaseLedger.loadActive(root);
    expect(ledger?.data.operations.push?.destination.canonicalUrl).toBe(remoteUrl);
    expect(JSON.stringify(ledger?.data)).not.toContain("checkout-managed-auth");
    await orchestrator.rollback();
  });

  test("accepts an ssh push remote with a username and preserves it in the recorded destination", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const remoteUrl = "ssh://git@github.com/fixture/repo.git";
    await Bun.$`git remote set-url --push origin ${remoteUrl}`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, push: true, tags: false });
    const pkg = makePackage();
    const stone = makePendingStone();

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);

    const ledger = await ReleaseLedger.loadActive(root);
    expect(ledger?.data.operations.push?.destination.canonicalUrl).toBe(remoteUrl);
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
          publishOnly: true,
          push: false,
          tags: false,
        },
        packages: [pkg],
        stones: [],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
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

  test("does not re-run the root build or clean outputs when every artifact is already in the ledger", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public").withVersions("1.0.0", "1.0.1");
    const rootCommand = makeRootBuildScript(root, { "packages/public/dist/types.d.ts": "export {};\n" });
    writeFileSync(join(root, ".gitignore"), "root-build-count.txt\n");
    writeFileSync(join(root, "packages/public/.gitignore"), "build-count.txt\ndist\n");
    writeFileSync(join(root, "root-build-count.txt"), "1");
    mkdirSync(join(root, "packages/public/dist"), { recursive: true });
    writeFileSync(join(root, "packages/public/dist/stale.js"), "export const stale = 1;\n");
    const artifactSource = join(root, ".git/published.tgz");
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
          publishOnly: true,
          push: false,
          tags: false,
        },
        packages: [pkg],
        stones: [],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
    const artifact = await ledger.setArtifact(pkg.name, artifactSource);

    registry = Bun.serve({
      port: 0,
      fetch() {
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

    const build = { outputs: ["packages/*/dist/**", "root-build-count.txt"], root: [rootCommand] };
    await ReleaseOrchestrator.resume(makeConfig(root, build));

    expect(readFileSync(join(root, "root-build-count.txt"), "utf-8")).toBe("1");
    expect(existsSync(join(root, "packages/public/dist/stale.js"))).toBe(true);
    expect(existsSync(join(root, "packages/public/build-count.txt"))).toBe(false);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });

  test("re-runs the root build and cleans outputs on resume when an artifact is missing", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const publicPkg = makePublishPackage(root, "packages/public", "@fixture/public").withVersions("1.0.0", "1.0.1");
    const otherPkg = makePublishPackage(root, "packages/other", "@fixture/other").withVersions("1.0.0", "1.0.1");
    for (const directory of ["packages/public", "packages/other"]) {
      const manifestPath = join(root, directory, "package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, files: ["dist"], version: "1.0.1" }, null, 2)}\n`);
      writeFileSync(join(root, directory, ".gitignore"), "build-count.txt\ndist\n");
    }
    writeFileSync(join(root, ".gitignore"), "root-build-count.txt\n");
    const rootCommand = makeRootBuildScript(root, {
      "packages/other/dist/types.d.ts": "export {};\n",
      "packages/public/dist/types.d.ts": "export {};\n",
    });
    makeConfig(root, { outputs: ["packages/*/dist/**", "root-build-count.txt"], root: [rootCommand] });
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "declare build outputs"`.quiet();
    mkdirSync(join(root, "packages/other/dist"), { recursive: true });
    writeFileSync(join(root, "packages/other/dist/stale.js"), "export const stale = 1;\n");
    const artifactSource = join(root, ".git/published.tgz");
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
          publishOnly: true,
          push: false,
          tags: false,
        },
        packages: [publicPkg, otherPkg],
        stones: [],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
    const artifact = await ledger.setArtifact(publicPkg.name, artifactSource);

    const published: string[] = [];
    registry = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method === "GET") {
          const packageName = decodeURIComponent(new URL(request.url).pathname.slice(1));
          if (!packageName.startsWith(publicPkg.name)) return Response.json({ error: "not found" }, { status: 404 });
          return Response.json({
            "dist-tags": { latest: "1.0.1" },
            name: publicPkg.name,
            versions: { "1.0.1": { dist: { integrity: artifact.integrity }, name: publicPkg.name, version: "1.0.1" } },
          });
        }
        published.push(decodeURIComponent(new URL(request.url).pathname.slice(1)));
        await request.arrayBuffer();
        return Response.json({ ok: true }, { status: 201 });
      },
    });
    process.env.BUN_CONFIG_REGISTRY = String(registry.url);
    process.env.BUN_CONFIG_TOKEN = crypto.randomUUID();
    process.env.NPM_CONFIG_REGISTRY = String(registry.url);
    process.env.NPM_CONFIG_PROVENANCE = "false";
    const registryUrl = new URL(registry.url);
    const userConfig = join(root, ".git/npmrc-test");
    writeFileSync(userConfig, `registry=${registry.url}\n//${registryUrl.host}/:_authToken=test-token\n`);
    process.env.NPM_CONFIG_USERCONFIG = userConfig;
    await ledger.setNpmRegistry(publicPkg.name, String(registry.url));
    await ledger.setPhase("local-ready");
    await ledger.markNpm(publicPkg.name, "started");
    expect(existsSync(join(root, "root-build-count.txt"))).toBe(false);

    await ReleaseOrchestrator.resume(makeConfig(root));

    expect(readFileSync(join(root, "root-build-count.txt"), "utf-8")).toBe("1");
    expect(existsSync(join(root, "packages/other/dist/stale.js"))).toBe(false);
    expect(existsSync(join(root, "packages/other/dist/types.d.ts"))).toBe(true);
    expect(readFileSync(join(root, "packages/other/build-count.txt"), "utf-8")).toBe("1");
    expect(published).toEqual(["@fixture/other"]);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
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
          publishOnly: true,
          push: false,
          tags: false,
        },
        packages: [pkg],
        stones: [],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, head);
    await ledger.setNpmRegistry(pkg.name, "https://registry.npmjs.org/");
    const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ ...rootManifest, catalog: { example: "2.0.0" } }, null, 2)}\n`,
    );

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow(
      "Release source path differs from the Git index: package.json",
    );

    const active = await ReleaseLedger.loadActive(root);
    expect(Object.keys(active?.data.artifacts ?? {})).toEqual([]);
    expect(active?.data.operations.npm[pkg.name]?.state).toBe("pending");
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
          publishOnly: true,
          push: true,
          tags: true,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await recordReleaseCommit(ledger, root, releaseCommit);
    await ledger.configurePush("origin", { canonicalUrl: pathToFileURL(remote).href }, [
      { destination: "refs/tags/moved-tag", oid: releaseCommit, source: "refs/tags/moved-tag" },
    ]);
    await ledger.setPhase("local-ready");

    await ReleaseOrchestrator.resume(makeConfig(root));

    const remoteTag = (await gitText(root, ["ls-remote", remote, "refs/tags/moved-tag"])).split("\t")[0];
    expect(remoteTag).toBe(releaseCommit);
  });

  test("rejects a publish-only resume from a same-tree child commit", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const pkg = makePackage();
    const ledger = await ReleaseLedger.create(
      {
        options: {
          changelog: false,
          createRelease: false,
          dryRun: false,
          npm: false,
          npmTag: "latest",
          publishOnly: true,
          push: false,
          tags: false,
        },
        packages: [pkg],
        stones: [makePendingStone()],
      },
      root,
    );
    const baseTree = await gitText(root, ["rev-parse", "HEAD^{tree}"]);
    await Bun.$`git commit -q --allow-empty -m "same tree child"`.quiet();

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow("must use commit");

    expect(ledger.data.expectedReleaseTree).toBe(baseTree);
    expect((await ReleaseLedger.loadActive(root))?.data.releaseCommit).toBeUndefined();
  });

  test("refuses to resume a legacy release commit without its expected tree", async () => {
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
          publishOnly: true,
          push: false,
          tags: false,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await ledger.setReleaseCommit(head);
    const legacy = ledger.data;
    delete legacy.expectedReleaseTree;
    writeFileSync(ledger.activePath, `${JSON.stringify(legacy, null, 2)}\n`);

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow("has no recorded expected release tree");

    expect((await ReleaseLedger.loadActive(root))?.data.releaseCommit).toBe(head);
  });

  test("refuses to resume a release that stopped before its release commit was created", async () => {
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
          push: true,
          tags: false,
        },
        packages: [makePackage()],
        stones: [makePendingStone()],
      },
      root,
    );
    await ledger.setExpectedReleaseTree(await gitText(root, ["rev-parse", `${head}^{tree}`]));

    await expect(ReleaseOrchestrator.resume(makeConfig(root))).rejects.toThrow(
      "stopped before its release commit was created",
    );

    expect(await ReleaseLedger.loadActive(root)).not.toBeNull();
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
