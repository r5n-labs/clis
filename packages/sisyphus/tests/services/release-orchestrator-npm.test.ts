import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Exit } from "@r5n/cli-core";
import { Package } from "../../src/domain/Package";
import { isValidNpmTag, type ReleaseOrchestrator } from "../../src/services/ReleaseOrchestrator";
import { ReleaseLedger } from "../../src/services/release-ledger";
import {
  CHANGELOG_FILE,
  type Fixture,
  gitText,
  makeOrchestrator,
  makePackage,
  makePendingStone,
  makePublishPackage,
  makeRootBuildScript,
  PUBLISH_SCRIPT,
  RELEASE_TAG,
  STONE_FILE,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";

async function captureIgnoredInputsExit(orchestrator: ReleaseOrchestrator): Promise<Exit> {
  const internals = orchestrator as unknown as { validateIgnoredBuildInputs(): Promise<void> };
  try {
    await internals.validateIgnoredBuildInputs();
  } catch (error) {
    if (error instanceof Exit) return error;
    throw error;
  }
  throw new Error("Expected ignored build inputs to be rejected");
}

describe("ReleaseOrchestrator npm publication", () => {
  const originalCwd = process.cwd();
  const originalRegistry = process.env.BUN_CONFIG_REGISTRY;
  const originalToken = process.env.BUN_CONFIG_TOKEN;
  const originalNpmRegistry = process.env.NPM_CONFIG_REGISTRY;
  const originalProvenance = process.env.NPM_CONFIG_PROVENANCE;
  const originalFetchRetries = process.env.NPM_CONFIG_FETCH_RETRIES;
  const originalUserConfig = process.env.NPM_CONFIG_USERCONFIG;
  let fixture: Fixture | undefined;
  let registry: ReturnType<typeof Bun.serve> | undefined;

  function startRegistry(failingPackage?: string, accessLevels: string[] = []): string[] {
    const requests: string[] = [];
    registry = Bun.serve({
      port: 0,
      async fetch(request) {
        const packageName = decodeURIComponent(new URL(request.url).pathname.slice(1));
        if (request.method === "GET") return Response.json({ error: "not found" }, { status: 404 });
        requests.push(packageName);
        const publication = (await request.json()) as { access: string };
        accessLevels.push(publication.access);
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

  test("skips private packages and publishes prepared public package artifacts", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();

    const privatePackage = makePublishPackage(root, "packages/private", "@fixture/private", { private: true });
    const publicPackage = makePublishPackage(root, "packages/public", "@fixture/public");
    await Bun.$`git add packages/private packages/public`.quiet();
    await Bun.$`git commit -q -m "add publish packages"`.quiet();
    const originalManifest = readFileSync(join(root, publicPackage.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([privatePackage, publicPackage], [], true);
    await orchestrator.finalizeExternalRelease([privatePackage, publicPackage], []);

    await orchestrator.publishToNpm([privatePackage, publicPackage]);

    expect(existsSync(join(root, "packages/private/build-count.txt"))).toBe(false);
    expect(readFileSync(join(root, "packages/public/build-count.txt"), "utf-8")).toBe("1");
    expect(readFileSync(join(root, publicPackage.file), "utf-8")).toBe(originalManifest);
    expect(published).toEqual(["@fixture/public"]);
  });

  test("preserves restricted publication access from the immutable artifact", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const accessLevels: string[] = [];
    const published = startRegistry(undefined, accessLevels);
    const pkg = makePublishPackage(root, "packages/restricted", "@fixture/restricted");
    const manifestPath = join(root, pkg.file);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, publishConfig: { access: "restricted" } }));
    await Bun.$`git add packages/restricted`.quiet();
    await Bun.$`git commit -q -m "add restricted package"`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await orchestrator.publishToNpm([pkg]);

    expect(published).toEqual(["@fixture/restricted"]);
    expect(accessLevels).toEqual(["restricted"]);
  });

  test("does not cross the npm boundary when all packages are private", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);

    const first = makePublishPackage(root, "packages/private-a", "@fixture/private-a", { private: true });
    const second = makePublishPackage(root, "packages/private-b", "@fixture/private-b", { private: true });
    await Bun.$`git add packages/private-a packages/private-b`.quiet();
    await Bun.$`git commit -q -m "add private packages"`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([first, second], [], true);
    await orchestrator.finalizeExternalRelease([first, second], []);

    await orchestrator.publishToNpm([first, second]);

    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
    expect(existsSync(join(root, "packages/private-a/build-count.txt"))).toBe(false);
    expect(existsSync(join(root, "packages/private-b/build-count.txt"))).toBe(false);
    expect(await orchestrator.rollback()).toBe(true);
  });

  test("rejects invalid publication access before recording an external operation", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/invalid-access", "@fixture/invalid-access");
    const manifestPath = join(root, pkg.file);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, publishConfig: { access: "restriced" } }));
    await Bun.$`git add packages/invalid-access`.quiet();
    await Bun.$`git commit -q -m "add invalid access"`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.prepareNpmPublish([pkg])).rejects.toThrow("Failed to prepare @fixture/invalid-access");

    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("publishes the immutable prepared artifact when the source manifest changes", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();

    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add public package"`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);
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
    await Bun.$`git add packages/invalid`.quiet();
    await Bun.$`git commit -q -m "add invalid package"`.quiet();
    const invalidPackage = new Package({
      file: invalidFile,
      name: "@fixture/invalid",
      newVersion: "1.0.0",
      version: "1.0.0",
    });
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([invalidPackage], [], true);

    await expect(orchestrator.finalizeExternalRelease([invalidPackage], [])).rejects.toThrow("Failed to parse");
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("prepares every public package once before publication and restores manifests on failure", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();

    const first = makePublishPackage(root, "packages/public-a", "@fixture/public-a");
    const second = makePublishPackage(root, "packages/public-b", "@fixture/public-b", { preparationFails: true });
    await Bun.$`git add packages/public-a packages/public-b`.quiet();
    await Bun.$`git commit -q -m "add public packages"`.quiet();
    const firstManifest = readFileSync(join(root, first.file), "utf-8");
    const secondManifest = readFileSync(join(root, second.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([first, second], [], true);
    await orchestrator.finalizeExternalRelease([first, second], []);

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
    const published = startRegistry();
    const sourcePackage = makePublishPackage(root, "packages/public", "@fixture/wrong");
    const pkg = new Package({
      file: sourcePackage.file,
      name: "@fixture/public",
      newVersion: "1.0.0",
      version: "1.0.0",
    });
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add mismatched public package"`.quiet();
    const originalManifest = readFileSync(join(root, pkg.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.prepareNpmPublish([pkg])).rejects.toThrow("Packed manifest identity mismatch");

    expect(readFileSync(join(root, pkg.file), "utf-8")).toBe(originalManifest);
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("aborts before publication when a build changes another tracked source file", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public", { sourceChanges: true });
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add public package"`.quiet();
    const originalManifest = readFileSync(join(root, pkg.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
      "Release source path differs from the Git index: packages/public/source.ts",
    );

    expect(readFileSync(join(root, pkg.file), "utf-8")).toBe(originalManifest);
    expect(readFileSync(join(root, "packages/public/source.ts"), "utf-8")).toBe("export const changed = true;\n");
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("rejects ignored pre-build files included by the package manifest", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    const manifestPath = join(root, pkg.file);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, files: ["ignored.js"] }, null, 2)}\n`);
    writeFileSync(join(root, "packages/public/.gitignore"), "build-count.txt\nignored.js\n");
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "include ignored source"`.quiet();
    writeFileSync(join(root, "packages/public/ignored.js"), "unbound payload\n");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
      "Repository contains 1 ignored build input(s) outside node_modules",
    );

    const error = await captureIgnoredInputsExit(orchestrator);
    expect(error.hint).toContain("packages/public/ignored.js");
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("rejects ignored inputs that a build would copy into generated output", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    const manifestPath = join(root, pkg.file);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, files: ["dist"], scripts: { ...manifest.scripts, build: "bun copy-ignored.ts" } }, null, 2)}\n`,
    );
    writeFileSync(
      join(root, "packages/public/copy-ignored.ts"),
      'await Bun.write("dist/output.js", await Bun.file("payload.txt").text());\n',
    );
    writeFileSync(join(root, "packages/public/.gitignore"), "build-count.txt\ndist/\npayload.txt\n");
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "copy ignored source"`.quiet();
    writeFileSync(join(root, "packages/public/payload.txt"), "unbound build input\n");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
      "Repository contains 1 ignored build input(s) outside node_modules",
    );

    const error = await captureIgnoredInputsExit(orchestrator);
    expect(error.hint).toContain("packages/public/payload.txt");
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("rejects tracked release source hidden by assume-unchanged", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add public package"`.quiet();
    await Bun.$`git update-index --assume-unchanged packages/public/prepare.ts`.quiet();
    writeFileSync(join(root, "packages/public/prepare.ts"), "await Bun.write('hidden.js', 'payload');\n");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);

    await expect(orchestrator.finalizeExternalRelease([pkg], [])).rejects.toThrow(
      "Release source index flags hide working tree changes: packages/public/prepare.ts",
    );

    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("rejects ignored package inputs inside a clean submodule", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    const dependency = mkdtempSync(join(tmpdir(), "sisyphus-package-submodule-"));
    writeFileSync(join(dependency, "tracked.js"), "export const tracked = true;\n");
    await Bun.$`git init -q -b main`.cwd(dependency).quiet();
    await Bun.$`git config user.email submodule@test.local`.cwd(dependency).quiet();
    await Bun.$`git config user.name "Sisyphus Submodule Test"`.cwd(dependency).quiet();
    await Bun.$`git add tracked.js`.cwd(dependency).quiet();
    await Bun.$`git commit -q -m init`.cwd(dependency).quiet();
    await Bun.$`git -c protocol.file.allow=always submodule add -q ${dependency} packages/public/vendor/dependency`.quiet();
    const manifestPath = join(root, pkg.file);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, files: ["vendor/dependency/ignored.js"] }, null, 2)}\n`,
    );
    await Bun.$`git add packages/public .gitmodules`.quiet();
    await Bun.$`git commit -q -m "add nested dependency"`.quiet();
    const submodule = join(root, "packages/public/vendor/dependency");
    const excludePath = resolve(
      submodule,
      (await Bun.$`git rev-parse --git-path info/exclude`.cwd(submodule).quiet()).stdout.toString().trim(),
    );
    writeFileSync(excludePath, "ignored.js\n", { flag: "a" });
    writeFileSync(join(submodule, "ignored.js"), "unbound nested payload\n");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    try {
      await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
        "Repository contains 1 ignored build input(s) outside node_modules",
      );
      const error = await captureIgnoredInputsExit(orchestrator);
      expect(error.hint).toContain("packages/public/vendor/dependency/ignored.js");
    } finally {
      rmSync(dependency, { force: true, recursive: true });
    }

    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("production publish wrapper prepares once and restores its source manifest", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    const published = startRegistry();

    const pkg = makePublishPackage(root, "packages/wrapper", "@fixture/wrapper");
    await Bun.$`git add packages/wrapper`.cwd(root).quiet();
    await Bun.$`git commit -q -m "add wrapper package"`.cwd(root).quiet();
    const manifestPath = join(root, pkg.file);
    const originalManifest = readFileSync(manifestPath, "utf-8");
    const result = await Bun.$`bun ${PUBLISH_SCRIPT} ${dirname(manifestPath)} --dry-run`.quiet().nothrow();

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(dirname(manifestPath), "build-count.txt"), "utf-8")).toBe("1");
    expect(readFileSync(manifestPath, "utf-8")).toBe(originalManifest);
    expect(published).toEqual([]);
  });

  test("preserves the recovery ledger when a build moves HEAD after the release commit", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public", { commitChanges: true }).withVersions(
      "1.0.0",
      "1.0.1",
    );
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add public package"`.quiet();
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    const stone = makePendingStone();
    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease([pkg], [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.finalizeExternalRelease([pkg], [stone]);
    const releaseCommit = await gitText(root, ["rev-parse", "HEAD"]);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
      "Publish source does not match the recorded release commit",
    );
    await expect(orchestrator.rollback(false)).rejects.toThrow("Cannot roll back release commit because HEAD changed");

    expect(await gitText(root, ["rev-parse", "HEAD"])).not.toBe(releaseCommit);
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
    expect((await ReleaseLedger.loadActive(root))?.data.releaseCommit).toBe(releaseCommit);
    expect(readFileSync(join(root, pkg.file), "utf-8")).toContain('"version": "1.0.1"');
  });

  test("rejects source changes that occur while the package artifact is packed", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public", { packSourceChanges: true });
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add public package"`.quiet();
    const originalManifest = readFileSync(join(root, pkg.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
      "Release source path differs from the Git index: packages/public/source.ts",
    );

    expect(readFileSync(join(root, pkg.file), "utf-8")).toBe(originalManifest);
    expect(readFileSync(join(root, "packages/public/source.ts"), "utf-8")).toBe("export const changed = true;\n");
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("rejects manifest changes that occur while the artifact is packed", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public", { packManifestChanges: true });
    await Bun.$`git add packages/public`.quiet();
    await Bun.$`git commit -q -m "add public package"`.quiet();
    const originalManifest = readFileSync(join(root, pkg.file), "utf-8");
    const orchestrator = makeOrchestrator(root, { changelog: false, npm: true, tags: false });
    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
      "Release source path differs from the Git index: packages/public/package.json",
    );

    expect(readFileSync(join(root, pkg.file), "utf-8")).not.toBe(originalManifest);
    expect(readFileSync(join(root, pkg.file), "utf-8")).toContain('"injected": "1.0.0"');
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
  });

  test("preserves local release state when a later npm publication fails", async () => {
    fixture = await setupReleaseFixture(true);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry("@fixture/public-b");

    const first = makePublishPackage(root, "packages/public-a", "@fixture/public-a");
    const second = makePublishPackage(root, "packages/public-b", "@fixture/public-b");
    await Bun.$`git add packages/public-a packages/public-b`.quiet();
    await Bun.$`git commit -q -m "add public packages"`.quiet();

    const orchestrator = makeOrchestrator(root, { npm: true });
    const pkg = makePackage();
    const stone = makePendingStone();
    const releasePackages = [pkg, first, second];

    await orchestrator.preflight([pkg], [stone]);
    await orchestrator.initializeExternalRelease(releasePackages, [stone], false);
    await orchestrator.updatePackageVersions([pkg]);
    appendFileSync(join(root, CHANGELOG_FILE), "\n## 1.0.1\n- ship it\n");
    rmSync(join(root, STONE_FILE));
    await orchestrator.createCommit(stone, [pkg], [stone]);
    await orchestrator.createGitTags([pkg]);
    await orchestrator.finalizeExternalRelease(releasePackages, [stone]);
    const releaseHead = await gitText(root, ["rev-parse", "HEAD"]);

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

    await orchestrator.initializeExternalRelease([pkg], [], true);
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
    await orchestrator.initializeExternalRelease([pkg], [], true);
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

  test("runs the configured root build once and packs its declared outputs", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const first = makePublishPackage(root, "packages/public", "@fixture/public");
    const second = makePublishPackage(root, "packages/other", "@fixture/other");

    for (const [directory, pkg] of [
      ["packages/public", first],
      ["packages/other", second],
    ] as const) {
      const manifestPath = join(root, pkg.file);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, files: ["dist"] }, null, 2)}\n`);
      writeFileSync(join(root, directory, ".gitignore"), "build-count.txt\ndist\n");
    }
    writeFileSync(join(root, ".gitignore"), "root-build-count.txt\n");
    const rootCommand = makeRootBuildScript(root, {
      "packages/other/dist/types.d.ts": "export {};\n",
      "packages/public/dist/types.d.ts": "export {};\n",
    });
    const orchestrator = makeOrchestrator(
      root,
      { changelog: false, npm: true, tags: false },
      { outputs: ["packages/*/dist/**", "root-build-count.txt"], root: [rootCommand] },
    );
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "declare build outputs"`.quiet();

    await orchestrator.initializeExternalRelease([first, second], [], true);
    await orchestrator.finalizeExternalRelease([first, second], []);
    await orchestrator.publishToNpm([first, second]);

    expect(published.sort()).toEqual(["@fixture/other", "@fixture/public"]);
    expect(readFileSync(join(root, "root-build-count.txt"), "utf-8")).toBe("1");
    expect(existsSync(join(root, "packages/public/dist/types.d.ts"))).toBe(true);
  });

  test("still rejects ignored files that are not declared build outputs", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    writeFileSync(join(root, "packages/public/.gitignore"), "build-count.txt\ndist\npayload.txt\n");
    const orchestrator = makeOrchestrator(
      root,
      { changelog: false, npm: true, tags: false },
      { outputs: ["packages/*/dist/**"] },
    );
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "declare ignores"`.quiet();
    writeFileSync(join(root, "packages/public/payload.txt"), "unbound payload\n");

    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
      "Repository contains 1 ignored build input(s) outside node_modules",
    );
    expect(published).toEqual([]);
  });

  test("rejects a declared build output that Git tracks", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    const orchestrator = makeOrchestrator(
      root,
      { changelog: false, npm: true, tags: false },
      { outputs: ["packages/public/prepare.ts"] },
    );
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "commit sources"`.quiet();

    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow(
      "Declared build output packages/public/prepare.ts is tracked by Git",
    );
    expect(published).toEqual([]);
    expect(existsSync(join(root, "packages/public/build-count.txt"))).toBe(false);
  });

  test("removes stale declared build outputs before the root build", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    writeFileSync(join(root, "packages/public/.gitignore"), "build-count.txt\ndist\n");
    writeFileSync(join(root, ".gitignore"), "root-build-count.txt\n");
    const rootCommand = makeRootBuildScript(root, { "packages/public/dist/fresh.js": "export const fresh = 1;\n" });
    const orchestrator = makeOrchestrator(
      root,
      { changelog: false, npm: true, tags: false },
      { outputs: ["packages/*/dist/**", "root-build-count.txt"], root: [rootCommand] },
    );
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "declare build outputs"`.quiet();
    mkdirSync(join(root, "packages/public/dist"), { recursive: true });
    writeFileSync(join(root, "packages/public/dist/stale.js"), "export const stale = 1;\n");

    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);
    await orchestrator.prepareNpmPublish([pkg]);

    expect(existsSync(join(root, "packages/public/dist/stale.js"))).toBe(false);
    expect(existsSync(join(root, "packages/public/dist/fresh.js"))).toBe(true);
  });

  test("passes build command arguments verbatim without shell interpretation", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    writeFileSync(join(root, "packages/public/.gitignore"), "build-count.txt\ndist\n");
    writeFileSync(
      join(root, "record-args.ts"),
      'await Bun.write("packages/public/dist/args.json", JSON.stringify(process.argv.slice(2)));\n',
    );
    writeFileSync(join(root, ".gitignore"), "root-build-count.txt\n");
    const argv = ["bun", "record-args.ts", "a b", "$(echo pwned)", "*", ";rm -rf /"];
    const orchestrator = makeOrchestrator(
      root,
      { changelog: false, npm: true, tags: false },
      { command: [], outputs: ["packages/*/dist/**"], root: [argv] },
    );
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "add arg recorder"`.quiet();

    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);
    await orchestrator.prepareNpmPublish([pkg]);

    const recorded = JSON.parse(readFileSync(join(root, "packages/public/dist/args.json"), "utf-8"));
    expect(recorded).toEqual(argv.slice(2));
  });

  test("fails the release when a root build command exits non-zero", async () => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    const published = startRegistry();
    const pkg = makePublishPackage(root, "packages/public", "@fixture/public");
    writeFileSync(join(root, "failing-build.ts"), "process.exit(1);\n");
    const orchestrator = makeOrchestrator(
      root,
      { changelog: false, npm: true, tags: false },
      { root: [["bun", "failing-build.ts"]] },
    );
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "add failing build"`.quiet();

    await orchestrator.initializeExternalRelease([pkg], [], true);
    await orchestrator.finalizeExternalRelease([pkg], []);

    await expect(orchestrator.publishToNpm([pkg])).rejects.toThrow("Failed to run release root build command 0");
    expect(published).toEqual([]);
    expect(orchestrator.hasCrossedIrreversibleBoundary()).toBe(false);
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
