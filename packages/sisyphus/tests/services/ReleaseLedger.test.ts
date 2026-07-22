import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type CreateReleaseLedgerInput, ReleaseLedger, type ReleaseLedgerData } from "../../src/services/ReleaseLedger";

const PACKAGE_NAME = "@fixture/public";
const PACKAGE_FILE = "packages/public/package.json";
const OID = "a".repeat(40);

const BASE_INPUT: CreateReleaseLedgerInput = {
  options: {
    changelog: true,
    createRelease: false,
    dryRun: false,
    npm: false,
    npmTag: "latest",
    publishOnly: false,
    push: false,
    tags: true,
  },
  packages: [{ file: PACKAGE_FILE, isPrivate: false, name: PACKAGE_NAME, newVersion: "1.0.1", oldVersion: "1.0.0" }],
  stones: [{ id: "0001-release", message: "ship it", patch: [PACKAGE_NAME] }],
};

async function createRepository(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "sisyphus-ledger-"));
  mkdirSync(join(root, dirname(PACKAGE_FILE)), { recursive: true });
  writeFileSync(join(root, PACKAGE_FILE), `${JSON.stringify({ name: PACKAGE_NAME, version: "1.0.0" }, null, 2)}\n`);
  await Bun.$`git init -q -b main`.cwd(root).quiet();
  await Bun.$`git config user.email ledger@test.local`.cwd(root).quiet();
  await Bun.$`git config user.name "Ledger Test"`.cwd(root).quiet();
  await Bun.$`git add -A`.cwd(root).quiet();
  await Bun.$`git commit -q -m init`.cwd(root).quiet();
  return root;
}

function input(options: Partial<CreateReleaseLedgerInput["options"]> = {}): CreateReleaseLedgerInput {
  return {
    ...BASE_INPUT,
    options: { ...BASE_INPUT.options, ...options },
    packages: BASE_INPUT.packages.map((pkg) => ({ ...pkg })),
    stones: BASE_INPUT.stones.map((stone) => ({ ...stone })),
  };
}

describe("ReleaseLedger", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  test("stores and loads active state outside the worktree without dirtying git status", async () => {
    const root = await createRepository();
    roots.push(root);
    const nested = join(root, "packages/public");

    const ledger = await ReleaseLedger.create(input(), nested);
    const loaded = await ReleaseLedger.loadActive(nested);

    expect(realpathSync(ledger.releaseDirectory)).toBe(realpathSync(join(root, ".git", "sisyphus", "release")));
    expect(ledger.activePath).toBe(join(ledger.releaseDirectory, "active.json"));
    expect(loaded?.data).toEqual(ledger.data);
    expect((await Bun.$`git status --porcelain`.cwd(root).quiet()).stdout.toString()).toBe("");
    expect(readFileSync(ledger.activePath, "utf-8").endsWith("\n")).toBe(true);
  });

  test("uses the worktree-specific git path", async () => {
    const root = await createRepository();
    const worktree = mkdtempSync(join(tmpdir(), "sisyphus-ledger-worktree-"));
    rmSync(worktree, { recursive: true });
    roots.push(root, worktree);
    await Bun.$`git worktree add -q -b ledger-worktree ${worktree}`.cwd(root).quiet();
    mkdirSync(join(worktree, "nested"));

    const ledger = await ReleaseLedger.create(input(), join(worktree, "nested"));
    const gitPath = (await Bun.$`git rev-parse --git-path sisyphus/release`.cwd(worktree).quiet()).stdout
      .toString()
      .trim();

    expect(ledger.releaseDirectory).toBe(resolve(worktree, gitPath));
    expect((await Bun.$`git status --porcelain`.cwd(worktree).quiet()).stdout.toString()).toBe("");
  });

  test("rejects an active ledger collision", async () => {
    const root = await createRepository();
    roots.push(root);
    await ReleaseLedger.create(input(), root);

    await expect(ReleaseLedger.create(input(), root)).rejects.toThrow("active ledger already exists");
  });

  test("allows only one concurrent ledger creator", async () => {
    const root = await createRepository();
    roots.push(root);

    const results = await Promise.allSettled([
      ReleaseLedger.create(input(), root),
      ReleaseLedger.create(input(), root),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await ReleaseLedger.loadActive(root)).not.toBeNull();
  });

  test("fails closed for corrupt JSON and unknown schema versions", async () => {
    const corruptRoot = await createRepository();
    const schemaRoot = await createRepository();
    roots.push(corruptRoot, schemaRoot);
    const corrupt = await ReleaseLedger.create(input(), corruptRoot);
    const unknown = await ReleaseLedger.create(input(), schemaRoot);
    writeFileSync(corrupt.activePath, "not json\n");
    writeFileSync(unknown.activePath, `${JSON.stringify({ ...unknown.data, schemaVersion: 2 }, null, 2)}\n`);

    await expect(ReleaseLedger.loadActive(corruptRoot)).rejects.toThrow("Failed to parse active release ledger");
    await expect(ReleaseLedger.loadActive(schemaRoot)).rejects.toThrow("unsupported schema version 2");
  });

  test("enforces operation transitions and refuses cleanup after external progress", async () => {
    const root = await createRepository();
    roots.push(root);
    const ledger = await ReleaseLedger.create(input({ createRelease: true, npm: true, push: true }), root);
    const source = join(root, "public.tgz");
    writeFileSync(source, "artifact");
    await ledger.setArtifact(PACKAGE_NAME, source);
    await ledger.setNpmRegistry(PACKAGE_NAME, "https://registry.npmjs.org/");
    await ledger.configurePush("origin", { canonicalUrl: "https://github.com/fixture/repo.git" }, [
      { destination: "refs/heads/main", oid: OID, source: "refs/heads/main" },
    ]);
    await ledger.configureProviderRelease(PACKAGE_NAME, {
      notes: "Release notes",
      tag: `${PACKAGE_NAME}@1.0.1`,
      title: `${PACKAGE_NAME} v1.0.1`,
    });

    await expect(ledger.markNpm(PACKAGE_NAME, "completed")).rejects.toThrow("transition from pending to completed");
    await ledger.markNpm(PACKAGE_NAME, "started");
    const startedAt = ledger.data.operations.npm[PACKAGE_NAME]?.startedAt;
    await ledger.markNpm(PACKAGE_NAME, "started");
    expect(ledger.data.operations.npm[PACKAGE_NAME]?.startedAt).toBe(startedAt);
    await ledger.markNpm(PACKAGE_NAME, "completed");
    await expect(ledger.markNpm(PACKAGE_NAME, "started")).rejects.toThrow("transition from completed to started");
    expect(ledger.hasExternalProgress()).toBe(true);
    await expect(ledger.remove()).rejects.toThrow("external operation has started");
    expect(existsSync(ledger.activePath)).toBe(true);
  });

  test("rejects credential-bearing registry query strings and fragments", async () => {
    const root = await createRepository();
    roots.push(root);
    const ledger = await ReleaseLedger.create(input({ npm: true }), root);

    await expect(ledger.setNpmRegistry(PACKAGE_NAME, "https://registry.example/?token=secret")).rejects.toThrow(
      "credential-free",
    );
    await expect(ledger.setNpmRegistry(PACKAGE_NAME, "https://registry.example/#secret")).rejects.toThrow(
      "credential-free",
    );
  });

  test("copies package artifacts durably and records their sha512 SRI", async () => {
    const root = await createRepository();
    roots.push(root);
    const ledger = await ReleaseLedger.create(input({ npm: true }), root);
    const source = join(root, "public.tgz");
    const content = Buffer.from("immutable package artifact");
    writeFileSync(source, content);

    const artifact = await ledger.setArtifact(PACKAGE_NAME, source);
    writeFileSync(source, "changed source");

    expect(artifact.path.startsWith("artifacts/")).toBe(true);
    expect(readFileSync(ledger.resolveArtifactPath(PACKAGE_NAME))).toEqual(content);
    expect(artifact.integrity).toBe(`sha512-${createHash("sha512").update(content).digest("base64")}`);
    expect((await ReleaseLedger.loadActive(root))?.data.artifacts[PACKAGE_NAME]).toEqual(artifact);
  });

  test("a stale writer cannot replace a durable artifact before failing CAS", async () => {
    const root = await createRepository();
    roots.push(root);
    const first = await ReleaseLedger.create(input({ npm: true }), root);
    const stale = await ReleaseLedger.loadActive(root);
    if (!stale) throw new Error("Expected active release ledger");
    const sourceA = join(root, "a.tgz");
    const sourceB = join(root, "b.tgz");
    writeFileSync(sourceA, "artifact-a");
    writeFileSync(sourceB, "artifact-b");

    const artifactA = await first.setArtifact(PACKAGE_NAME, sourceA);
    await expect(stale.setArtifact(PACKAGE_NAME, sourceB)).rejects.toThrow("different durable artifact");

    expect((await ReleaseLedger.loadActive(root))?.data.artifacts[PACKAGE_NAME]).toEqual(artifactA);
    expect(readFileSync(first.resolveArtifactPath(PACKAGE_NAME), "utf-8")).toBe("artifact-a");
  });

  test("a stale handle cannot remove a ledger after external progress starts", async () => {
    const root = await createRepository();
    roots.push(root);
    const current = await ReleaseLedger.create(input({ npm: true }), root);
    const stale = await ReleaseLedger.loadActive(root);
    if (!stale) throw new Error("Expected active release ledger");
    const source = join(root, "artifact.tgz");
    writeFileSync(source, "artifact");
    await current.setArtifact(PACKAGE_NAME, source);
    await current.setNpmRegistry(PACKAGE_NAME, "https://registry.npmjs.org/");
    await current.markNpm(PACKAGE_NAME, "started");

    await expect(stale.remove()).rejects.toThrow("changed in another process");

    const active = await ReleaseLedger.loadActive(root);
    expect(active?.data.operations.npm[PACKAGE_NAME]?.state).toBe("started");
    expect(active?.data.artifacts[PACKAGE_NAME]).toBeDefined();
  });

  test("rejects package traversal and artifact metadata outside its durable directory", async () => {
    const root = await createRepository();
    roots.push(root);
    const ledger = await ReleaseLedger.create(input({ npm: true }), root);
    const source = join(root, "public.tgz");
    writeFileSync(source, "artifact");
    await expect(ledger.setArtifact("../public", source)).rejects.toThrow("Unknown release package");
    await ledger.setArtifact(PACKAGE_NAME, source);

    const corrupted: ReleaseLedgerData = ledger.data;
    const metadata = corrupted.artifacts[PACKAGE_NAME];
    if (!metadata) throw new Error("Expected artifact metadata");
    metadata.path = join(root, "escaped.tgz");
    writeFileSync(metadata.path, "artifact");
    writeFileSync(ledger.activePath, `${JSON.stringify(corrupted, null, 2)}\n`);

    await expect(ReleaseLedger.loadActive(root)).rejects.toThrow("must be relative to the release directory");
  });

  test("refuses an artifacts-directory symlink before copying data", async () => {
    const root = await createRepository();
    roots.push(root);
    const ledger = await ReleaseLedger.create(input({ npm: true }), root);
    const outside = join(root, "outside");
    const source = join(root, "public.tgz");
    mkdirSync(outside);
    writeFileSync(source, "artifact");
    rmSync(ledger.artifactsDirectory, { recursive: true });
    symlinkSync(outside, ledger.artifactsDirectory, "dir");

    await expect(ledger.setArtifact(PACKAGE_NAME, source)).rejects.toThrow("expected a real directory");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("atomically moves completed state to history and keeps durable artifacts", async () => {
    const root = await createRepository();
    roots.push(root);
    const ledger = await ReleaseLedger.create(input({ npm: true }), root);
    const source = join(root, "public.tgz");
    writeFileSync(source, "artifact");
    await ledger.setArtifact(PACKAGE_NAME, source);
    await ledger.setNpmRegistry(PACKAGE_NAME, "https://registry.npmjs.org/");
    await ledger.markNpm(PACKAGE_NAME, "started");
    await ledger.markNpm(PACKAGE_NAME, "completed");
    await ledger.setReleaseCommit(OID);
    await ledger.markTagsReady();

    const historyPath = await ledger.complete();
    const history = JSON.parse(readFileSync(historyPath, "utf-8")) as ReleaseLedgerData;

    expect(existsSync(ledger.activePath)).toBe(false);
    expect(history.phase).toBe("completed");
    expect(history.id).toBe(ledger.id);
    expect(existsSync(ledger.resolveArtifactPath(PACKAGE_NAME))).toBe(true);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
    expect(readFileSync(historyPath, "utf-8").endsWith("\n")).toBe(true);
  });
});
