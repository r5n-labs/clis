import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
