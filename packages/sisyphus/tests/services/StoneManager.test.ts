import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager, Exit } from "@r5n/cli-core";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { Stone } from "../../src/domain";
import { StoneManager } from "../../src/services/StoneManager";
import type { SisyphusConfig } from "../../src/types";

describe("StoneManager safe IDs", () => {
  const originalCwd = process.cwd();
  let manager: StoneManager;
  let root: string;
  let stonesDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sisyphus-stones-"));
    stonesDir = join(root, ".sisyphus/stones");
    mkdirSync(stonesDir, { recursive: true });
    process.chdir(root);
    const config = new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), SISYPHUS_DEFAULT_CONFIG);
    manager = new StoneManager(config);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(root, { force: true, recursive: true });
  });

  test("list rejects unsafe filename-derived IDs before loading files", async () => {
    writeFileSync(join(stonesDir, "...json"), "{}\n");

    const error = await manager.list().then(
      () => null,
      (cause: unknown) => cause,
    );
    if (!(error instanceof Exit)) throw new Error("Expected an Exit error for the junk stone file");
    expect(error.message).toContain('Invalid stone ID ".."');
    expect(error.message).toContain("...json");
    expect(error.message).toContain(".sisyphus/stones");
    expect(error.hint).toContain("Remove or rename the file");
  });

  test("get rejects traversal IDs without reading outside the stones directory", async () => {
    const outsideFile = join(root, ".sisyphus/outside.json");
    writeFileSync(outsideFile, '{"id":"outside","message":"outside"}\n');

    await expect(manager.get("../outside")).rejects.toThrow("Invalid stone ID");
    expect(readFileSync(outsideFile, "utf-8")).toContain("outside");
  });

  test("delete rejects traversal IDs without deleting outside files", async () => {
    const outsideFile = join(root, ".sisyphus/outside.json");
    writeFileSync(outsideFile, '{"id":"outside","message":"outside"}\n');

    await expect(manager.delete("../outside")).rejects.toThrow("Invalid stone ID");
    expect(existsSync(outsideFile)).toBe(true);
  });

  test("get names the stone file path when JSON parsing fails", async () => {
    writeFileSync(join(stonesDir, "0001-broken.json"), "{not json\n");

    const error = await manager.get("0001-broken").then(
      () => null,
      (cause: unknown) => cause,
    );
    if (!(error instanceof Exit)) throw new Error("Expected an Exit error for the corrupt stone file");
    expect(error.message).toContain("Failed to parse stone file");
    expect(error.message).toContain(".sisyphus/stones");
    expect(error.message).toContain("0001-broken.json");
    expect(error.hint).toBe("Remove or fix the file");
  });

  test("released stone parse failures name the archived file when IDs are pinned", async () => {
    const timestamp = "2026-07-21T12-34-56-789Z";
    const archive = join(root, ".sisyphus/released", timestamp);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "0001-safe.json"), "{broken\n");

    const error = await manager.getReleasedStones(timestamp, ["0001-safe"]).then(
      () => null,
      (cause: unknown) => cause,
    );
    if (!(error instanceof Exit)) throw new Error("Expected an Exit error for the corrupt archived stone file");
    expect(error.message).toContain("Failed to parse stone file");
    expect(error.message).toContain(join(".sisyphus/released", timestamp, "0001-safe.json"));
    expect(error.hint).toBe("Remove or fix the file");
  });

  test("requires loaded JSON IDs to match the filename-derived ID", async () => {
    writeFileSync(join(stonesDir, "0001-safe.json"), '{"id":"0002-other","message":"mismatch"}\n');

    await expect(manager.get("0001-safe")).rejects.toThrow(
      'Stone file ID mismatch: expected "0001-safe", found "0002-other"',
    );
    await expect(manager.list()).rejects.toThrow("Stone file ID mismatch");
  });

  test("rejects traversal-shaped released timestamps", async () => {
    await expect(manager.getReleasedStones("../../outside")).rejects.toThrow("Invalid released stone timestamp");
  });

  test("tracked commit packages merge coverage per hash across pending stones", async () => {
    const commit = {
      hash: "abc1234",
      message: "update both",
      packages: ["@fixture/foo"],
      subject: "fix: update both",
      type: "fix",
    };
    await manager.save(
      Stone.fromJson({ commits: [commit], id: "0001-aaaa1111", message: "Bug fixes", patch: ["@fixture/foo"] }),
    );
    await manager.save(
      Stone.fromJson({
        commits: [{ ...commit, packages: ["@fixture/bar"] }],
        id: "0002-bbbb2222",
        message: "Bug fixes",
        patch: ["@fixture/bar"],
      }),
    );

    const tracked = await manager.getTrackedCommitPackages();
    expect(tracked.size).toBe(1);
    expect([...(tracked.get("abc1234") ?? [])].sort()).toEqual(["@fixture/bar", "@fixture/foo"]);
  });

  test("requires archived stones to match the exact currentRelease IDs", async () => {
    const timestamp = "2026-07-21T12-34-56-789Z";
    const archive = join(root, ".sisyphus/released", timestamp);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "0001-safe.json"), '{"id":"0001-safe","message":"safe"}\n');
    writeFileSync(join(archive, "0002-extra.json"), '{"id":"0002-extra","message":"extra"}\n');

    await expect(manager.getReleasedStones(timestamp, ["0001-safe"])).rejects.toThrow("does not match currentRelease");
  });
});
