import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashReleasePlan, hashReleaseSource } from "../../src/services/ReleaseSource";

describe("hashReleaseSource", () => {
  const originalCwd = process.cwd();
  const roots: string[] = [];

  afterEach(() => {
    process.chdir(originalCwd);
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  test("tracks repository source while excluding Sisyphus release metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "sisyphus-source-"));
    roots.push(root);
    mkdirSync(join(root, ".sisyphus"), { recursive: true });
    writeFileSync(join(root, "source.ts"), "export const value = 1;\n");
    writeFileSync(join(root, ".sisyphus/config.json"), '{"stones":[]}\n');
    await Bun.$`git init -q -b main`.cwd(root).quiet();
    await Bun.$`git add -A`.cwd(root).quiet();
    process.chdir(root);

    const initial = await hashReleaseSource(".sisyphus");
    writeFileSync(join(root, ".sisyphus/config.json"), '{"stones":["pending"]}\n');
    const metadataChanged = await hashReleaseSource(".sisyphus");
    writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
    const sourceChanged = await hashReleaseSource(".sisyphus");

    expect(metadataChanged).toBe(initial);
    expect(sourceChanged).not.toBe(initial);

    writeFileSync(join(root, "source.ts"), "export const value = 1;\n");
    chmodSync(join(root, "source.ts"), 0o755);
    expect(await hashReleaseSource(".sisyphus")).not.toBe(initial);
  });

  test("hashes new files as tracked once staged, matching the committed state", async () => {
    const root = mkdtempSync(join(tmpdir(), "sisyphus-staged-source-"));
    roots.push(root);
    mkdirSync(join(root, ".sisyphus"), { recursive: true });
    writeFileSync(join(root, "source.ts"), "export const value = 1;\n");
    await Bun.$`git init -q -b main`.cwd(root).quiet();
    await Bun.$`git config user.email release@test.local`.cwd(root).quiet();
    await Bun.$`git config user.name "Sisyphus Release Test"`.cwd(root).quiet();
    await Bun.$`git add -A`.cwd(root).quiet();
    await Bun.$`git commit -q -m init`.cwd(root).quiet();
    process.chdir(root);

    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
    const untrackedHash = await hashReleaseSource(".sisyphus");

    await Bun.$`git add CHANGELOG.md`.cwd(root).quiet();
    const stagedHash = await hashReleaseSource(".sisyphus");

    await Bun.$`git commit -q -m release`.cwd(root).quiet();
    const committedHash = await hashReleaseSource(".sisyphus");

    expect(stagedHash).not.toBe(untrackedHash);
    expect(committedHash).toBe(stagedHash);
  });

  test("hashes tracked symlink targets without following them", async () => {
    const root = mkdtempSync(join(tmpdir(), "sisyphus-symlink-source-"));
    roots.push(root);
    mkdirSync(join(root, ".sisyphus"), { recursive: true });
    symlinkSync("missing-first-target", join(root, "current"));
    await Bun.$`git init -q -b main`.cwd(root).quiet();
    await Bun.$`git add current`.cwd(root).quiet();
    process.chdir(root);

    const initial = await hashReleaseSource(".sisyphus");
    rmSync(join(root, "current"));
    symlinkSync("missing-second-target", join(root, "current"));

    expect(await hashReleaseSource(".sisyphus")).not.toBe(initial);
  });

  test("hashes clean gitlinks and rejects dirty checked-out submodules", async () => {
    const root = mkdtempSync(join(tmpdir(), "sisyphus-gitlink-source-"));
    const submoduleSource = mkdtempSync(join(tmpdir(), "sisyphus-submodule-source-"));
    roots.push(root, submoduleSource);
    mkdirSync(join(root, ".sisyphus"), { recursive: true });
    writeFileSync(join(submoduleSource, "source.txt"), "clean\n");
    await Bun.$`git init -q -b main`.cwd(submoduleSource).quiet();
    await Bun.$`git config user.email submodule@test.local`.cwd(submoduleSource).quiet();
    await Bun.$`git config user.name "Sisyphus Submodule Test"`.cwd(submoduleSource).quiet();
    await Bun.$`git add source.txt`.cwd(submoduleSource).quiet();
    await Bun.$`git commit -q -m init`.cwd(submoduleSource).quiet();
    await Bun.$`git init -q -b main`.cwd(root).quiet();
    await Bun.$`git -c protocol.file.allow=always submodule add -q ${submoduleSource} vendor/dependency`
      .cwd(root)
      .quiet();
    const recordedObjectId = (await Bun.$`git rev-parse :vendor/dependency`.cwd(root).quiet()).stdout.toString().trim();
    process.chdir(root);

    await expect(hashReleaseSource(".sisyphus")).resolves.toMatch(/^[0-9a-f]{64}$/);

    writeFileSync(join(root, "vendor/dependency/source.txt"), "dirty\n");
    await expect(hashReleaseSource(".sisyphus")).rejects.toThrow("Release source gitlink is dirty: vendor/dependency");

    await Bun.$`git config user.email submodule@test.local`.cwd(join(root, "vendor/dependency")).quiet();
    await Bun.$`git config user.name "Sisyphus Submodule Test"`.cwd(join(root, "vendor/dependency")).quiet();
    await Bun.$`git add source.txt`.cwd(join(root, "vendor/dependency")).quiet();
    await Bun.$`git commit -q -m next`.cwd(join(root, "vendor/dependency")).quiet();

    await expect(hashReleaseSource(".sisyphus")).rejects.toThrow(
      "Release source gitlink does not match the recorded commit: vendor/dependency",
    );

    rmSync(join(root, "vendor/dependency"), { force: true, recursive: true });
    await expect(hashReleaseSource(".sisyphus")).rejects.toThrow(
      "Release source gitlink is not initialized: vendor/dependency",
    );

    mkdirSync(join(root, "vendor/dependency"), { recursive: true });
    writeFileSync(join(root, "vendor/dependency/injected.txt"), "not a submodule\n");
    await expect(hashReleaseSource(".sisyphus")).rejects.toThrow(
      "Release source gitlink is not initialized: vendor/dependency",
    );

    rmSync(join(root, "vendor/dependency"), { force: true, recursive: true });
    await Bun.$`git clone -q ${submoduleSource} vendor/dependency`.cwd(root).quiet();
    await Bun.$`git checkout -q ${recordedObjectId}`.cwd(join(root, "vendor/dependency")).quiet();
    await expect(hashReleaseSource(".sisyphus")).rejects.toThrow(
      "Release source gitlink is not initialized: vendor/dependency",
    );
  });

  test("binds release packages and complete stone contents into the plan hash", () => {
    const plan = {
      packages: { "@fixture/pkg": { newVersion: "1.0.1", oldVersion: "1.0.0" } },
      sourceHash: "a".repeat(64),
      stoneIds: ["0001-release"],
      timestamp: "2026-07-21T12-34-56-789Z",
    };
    const stones = [{ id: "0001-release", message: "fix: release", patch: ["@fixture/pkg"] }];
    const hash = hashReleasePlan(plan, stones);

    expect(hashReleasePlan(plan, stones)).toBe(hash);
    expect(hashReleasePlan({ ...plan, packages: {} }, stones)).not.toBe(hash);
    expect(hashReleasePlan(plan, [{ id: "0001-release", message: "tampered", patch: ["@fixture/pkg"] }])).not.toBe(
      hash,
    );
  });

  test("hashes release plans independently of object value insertion order", () => {
    const base = { sourceHash: "b".repeat(64), stoneIds: ["0001-release"], timestamp: "2026-07-21T12-34-56-789Z" };
    const first = hashReleasePlan(
      { ...base, packages: { "@fixture/pkg": { newVersion: "1.0.1", oldVersion: "1.0.0" } } },
      [],
    );
    const second = hashReleasePlan(
      { ...base, packages: { "@fixture/pkg": { oldVersion: "1.0.0", newVersion: "1.0.1" } } },
      [],
    );

    expect(second).toBe(first);
  });

  test("freezes the canonical plan hash format", () => {
    const plan = {
      packages: { "@fixture/pkg": { newVersion: "1.0.1", oldVersion: "1.0.0" } },
      sourceHash: "a".repeat(64),
      stoneIds: ["0001-release"],
      timestamp: "2026-07-21T12-34-56-789Z",
    };
    const stones = [{ id: "0001-release", message: "fix: release", patch: ["@fixture/pkg"] }];

    expect(hashReleasePlan(plan, stones)).toBe("ff1c21694538f5c8773465432105b6e478cf0ef1ed019f5a0c67b2052d478cbd");
  });
});
