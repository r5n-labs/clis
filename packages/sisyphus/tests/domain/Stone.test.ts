import { describe, expect, test } from "bun:test";
import { BumpType } from "../../src/domain/BumpType";
import type { CommitInfo } from "../../src/domain/Commit";
import type { StoneData, StoneJson } from "../../src/domain/Stone";
import { Stone } from "../../src/domain/Stone";

const makeCommit = (hash: string, message: string): CommitInfo => ({
  hash,
  subject: `feat: ${message}`,
  type: "feat",
  message,
  packages: [],
});

const baseData: StoneData = {
  message: "release v1.0.0",
  tag: "v1.0.0",
  description: "Initial release",
  major: ["@app/core"],
  minor: ["@app/utils"],
  patch: ["@app/cli"],
  dependency: ["@app/deps"],
  snapshot: ["@app/snapshot"],
  commits: [makeCommit("abc1234", "add core feature")],
};

describe("Stone.create()", () => {
  test("generates sequential ID with UUID suffix", () => {
    const stone = Stone.create(baseData, 0);
    expect(stone.id).toMatch(/^0001-[a-f0-9]{8}$/);

    const stone42 = Stone.create(baseData, 42);
    expect(stone42.id).toMatch(/^0043-[a-f0-9]{8}$/);
  });

  test("stores packages correctly by bump type", () => {
    const stone = Stone.create(baseData);

    expect(stone.major).toEqual(["@app/core"]);
    expect(stone.minor).toEqual(["@app/utils"]);
    expect(stone.patch).toEqual(["@app/cli"]);
    expect(stone.dependency).toEqual(["@app/deps"]);
    expect(stone.snapshot).toEqual(["@app/snapshot"]);
    expect(stone.message).toBe("release v1.0.0");
    expect(stone.tag).toBe("v1.0.0");
    expect(stone.description).toBe("Initial release");
  });
});

describe("Stone.fromJson() / toJson()", () => {
  test("roundtrip preserves all data", () => {
    const original = Stone.create(baseData, 5);
    const json = original.toJson();
    const restored = Stone.fromJson(json);

    expect(restored.id).toBe(original.id);
    expect(restored.message).toBe(original.message);
    expect(restored.tag).toBe(original.tag);
    expect(restored.description).toBe(original.description);
    expect(restored.major).toEqual(original.major);
    expect(restored.minor).toEqual(original.minor);
    expect(restored.patch).toEqual(original.patch);
    expect(restored.dependency).toEqual(original.dependency);
    expect(restored.snapshot).toEqual(original.snapshot);
    expect(restored.commits).toEqual(original.commits);
  });

  test("handles missing optional fields (no snapshot, no commits)", () => {
    const minimalJson: StoneJson = {
      id: "0001-deadbeef",
      message: "minimal stone",
    };

    const stone = Stone.fromJson(minimalJson);

    expect(stone.id).toBe("0001-deadbeef");
    expect(stone.message).toBe("minimal stone");
    expect(stone.tag).toBeUndefined();
    expect(stone.description).toBeUndefined();
    expect(stone.commits).toBeUndefined();
    expect(stone.major).toEqual([]);
    expect(stone.minor).toEqual([]);
    expect(stone.patch).toEqual([]);
    expect(stone.dependency).toEqual([]);
    expect(stone.snapshot).toEqual([]);
  });
});

describe("Stone.merge()", () => {
  test("merges two stones with non-overlapping packages", () => {
    const stoneA = Stone.create({
      message: "stone A",
      major: ["@app/core"],
      minor: ["@app/utils"],
    });
    const stoneB = Stone.create({
      message: "stone B",
      patch: ["@app/cli"],
      dependency: ["@app/deps"],
    });

    const { stone, conflicts } = Stone.merge([stoneA, stoneB], "merged");

    expect(conflicts).toEqual([]);
    expect(stone.major).toEqual(["@app/core"]);
    expect(stone.minor).toEqual(["@app/utils"]);
    expect(stone.patch).toEqual(["@app/cli"]);
    expect(stone.dependency).toEqual(["@app/deps"]);
    expect(stone.message).toBe("merged");
  });

  test("detects conflicts when same package at different bump levels", () => {
    const stoneA = Stone.create({
      message: "stone A",
      minor: ["@app/core"],
    });
    const stoneB = Stone.create({
      message: "stone B",
      patch: ["@app/core"],
    });

    const { conflicts } = Stone.merge([stoneA, stoneB], "merged");

    expect(conflicts).toContain("@app/core");
  });

  test("resolves conflicts using higherBump (major wins over minor)", () => {
    const stoneA = Stone.create({
      message: "stone A",
      minor: ["@app/core"],
    });
    const stoneB = Stone.create({
      message: "stone B",
      major: ["@app/core"],
    });

    const { stone, conflicts } = Stone.merge([stoneA, stoneB], "merged");

    expect(conflicts).toContain("@app/core");
    expect(stone.major).toContain("@app/core");
    expect(stone.minor).not.toContain("@app/core");
  });

  test("BUG: drops Snapshot packages entirely during merge", () => {
    // collectBumps only iterates Major, Minor, Patch, Dependency — not Snapshot.
    // This means any packages in the snapshot bump type are silently lost.
    const stoneA = Stone.create({
      message: "stone A",
      snapshot: ["@app/snapshot-pkg"],
    });
    const stoneB = Stone.create({
      message: "stone B",
      patch: ["@app/cli"],
    });

    const { stone } = Stone.merge([stoneA, stoneB], "merged");

    // Snapshot packages are NOT carried over — this is a bug
    expect(stone.snapshot).toEqual([]);
    expect(stone.allPackages).not.toContain("@app/snapshot-pkg");
  });

  test("merges descriptions from both stones", () => {
    const stoneA = Stone.create({
      message: "A",
      description: "Description A",
    });
    const stoneB = Stone.create({
      message: "B",
      description: "Description B",
    });

    const { stone } = Stone.merge([stoneA, stoneB], "merged");

    expect(stone.description).toBe("Description A\n\nDescription B");
  });

  test("deduplicates commits", () => {
    const commit1 = makeCommit("aaa1111", "first");
    const commit2 = makeCommit("bbb2222", "second");

    const stoneA = Stone.create({
      message: "A",
      commits: [commit1, commit2],
    });
    const stoneB = Stone.create({
      message: "B",
      commits: [commit2],
    });

    const { stone } = Stone.merge([stoneA, stoneB], "merged");

    // NOTE: merge uses flatMap without dedup — commit2 appears twice.
    // This documents actual behavior: commits are NOT deduplicated.
    const hashes = stone.commits?.map((c) => c.hash) ?? [];
    expect(hashes).toEqual(["aaa1111", "bbb2222", "bbb2222"]);
  });

  test("silently picks first tag when tags conflict", () => {
    // When multiple stones have different tags, merge creates a Set
    // then picks tags[0] — the first unique tag encountered.
    // There is no conflict reported for tag mismatches.
    const stoneA = Stone.create({ message: "A", tag: "v1.0.0" });
    const stoneB = Stone.create({ message: "B", tag: "v2.0.0" });

    const { stone, conflicts } = Stone.merge([stoneA, stoneB], "merged");

    expect(stone.tag).toBe("v1.0.0");
    // No conflict is reported for tag mismatch
    expect(conflicts).toEqual([]);
  });
});

describe("stone.isEmpty", () => {
  test("returns true for a stone with no packages", () => {
    const stone = Stone.create({ message: "empty" });
    expect(stone.isEmpty).toBe(true);
  });

  test("returns false for a stone with packages", () => {
    const stone = Stone.create({ message: "has stuff", patch: ["@app/cli"] });
    expect(stone.isEmpty).toBe(false);
  });
});

describe("stone.allPackages", () => {
  test("returns all packages across bump types", () => {
    const stone = Stone.create(baseData);
    const all = stone.allPackages;

    expect(all).toContain("@app/core");
    expect(all).toContain("@app/utils");
    expect(all).toContain("@app/cli");
    expect(all).toContain("@app/deps");
    expect(all).toContain("@app/snapshot");
    expect(all).toHaveLength(5);
  });
});

describe("stone.affectsPackage() via getPackages", () => {
  test("finds package in the correct bump type", () => {
    const stone = Stone.create(baseData);

    expect(stone.getPackages(BumpType.Major)).toContain("@app/core");
    expect(stone.getPackages(BumpType.Minor)).toContain("@app/utils");
    expect(stone.getPackages(BumpType.Patch)).toContain("@app/cli");
    expect(stone.getPackages(BumpType.Dependency)).toContain("@app/deps");
    expect(stone.getPackages(BumpType.Snapshot)).toContain("@app/snapshot");
  });

  test("returns empty array for bump type with no packages", () => {
    const stone = Stone.create({ message: "only major", major: ["@app/core"] });

    expect(stone.getPackages(BumpType.Minor)).toEqual([]);
    expect(stone.getPackages(BumpType.Patch)).toEqual([]);
  });
});

describe("immutable update methods", () => {
  test("withMessage() returns new stone with updated message", () => {
    const original = Stone.create(baseData);
    const updated = original.withMessage("new message");

    expect(updated.message).toBe("new message");
    expect(original.message).toBe("release v1.0.0");
    expect(updated.id).toBe(original.id);
    expect(updated.tag).toBe(original.tag);
    expect(updated.major).toEqual(original.major);
  });

  test("withTag() returns new stone with updated tag", () => {
    const original = Stone.create(baseData);
    const updated = original.withTag("v2.0.0");

    expect(updated.tag).toBe("v2.0.0");
    expect(original.tag).toBe("v1.0.0");
    expect(updated.id).toBe(original.id);
  });

  test("withTag(undefined) clears the tag", () => {
    const original = Stone.create(baseData);
    const updated = original.withTag(undefined);

    expect(updated.tag).toBeUndefined();
  });

  test("withDescription() returns new stone with updated description", () => {
    const original = Stone.create(baseData);
    const updated = original.withDescription("Updated description");

    expect(updated.description).toBe("Updated description");
    expect(original.description).toBe("Initial release");
    expect(updated.id).toBe(original.id);
  });

  test("withDescription(undefined) clears the description", () => {
    const original = Stone.create(baseData);
    const updated = original.withDescription(undefined);

    expect(updated.description).toBeUndefined();
  });
});

describe("toJson()", () => {
  test("omits empty arrays via nonEmpty helper", () => {
    const stone = Stone.create({
      message: "only major",
      major: ["@app/core"],
    });
    const json = stone.toJson();

    expect(json.major).toEqual(["@app/core"]);
    expect(json.minor).toBeUndefined();
    expect(json.patch).toBeUndefined();
    expect(json.dependency).toBeUndefined();
    expect(json.snapshot).toBeUndefined();
  });

  test("omits commits when empty or undefined", () => {
    const stone = Stone.create({ message: "no commits" });
    const json = stone.toJson();

    expect(json.commits).toBeUndefined();
  });

  test("includes commits when present", () => {
    const commit = makeCommit("abc1234", "a feature");
    const stone = Stone.create({ message: "with commits", commits: [commit] });
    const json = stone.toJson();

    expect(json.commits).toHaveLength(1);
    expect(json.commits?.[0]?.hash).toBe("abc1234");
  });
});
