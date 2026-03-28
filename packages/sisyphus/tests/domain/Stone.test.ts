import { describe, expect, test } from "bun:test";
import { BumpType } from "../../src/domain/BumpType";
import type { CommitInfo } from "../../src/domain/Commit";
import type { StoneData } from "../../src/domain/Stone";
import { Stone } from "../../src/domain/Stone";

const makeCommit = (hash: string, message: string): CommitInfo => ({
  hash,
  message,
  packages: [],
  subject: `feat: ${message}`,
  type: "feat",
});

const baseData: StoneData = {
  commits: [makeCommit("abc1234", "add core feature")],
  dependency: ["@app/deps"],
  description: "Initial release",
  major: ["@app/core"],
  message: "release v1.0.0",
  minor: ["@app/utils"],
  patch: ["@app/cli"],
  snapshot: ["@app/snapshot"],
  tag: "v1.0.0",
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

    expect(stone).toMatchObject({
      dependency: ["@app/deps"],
      description: "Initial release",
      major: ["@app/core"],
      message: "release v1.0.0",
      minor: ["@app/utils"],
      patch: ["@app/cli"],
      snapshot: ["@app/snapshot"],
      tag: "v1.0.0",
    });
  });
});

describe("Stone.fromJson() / toJson()", () => {
  test("roundtrip preserves all data", () => {
    const original = Stone.create(baseData, 5);
    const restored = Stone.fromJson(original.toJson());

    expect(restored).toMatchObject({
      commits: original.commits,
      dependency: original.dependency,
      description: original.description,
      id: original.id,
      major: original.major,
      message: original.message,
      minor: original.minor,
      patch: original.patch,
      snapshot: original.snapshot,
      tag: original.tag,
    });
  });

  test("handles missing optional fields (no snapshot, no commits)", () => {
    const stone = Stone.fromJson({ id: "0001-deadbeef", message: "minimal stone" });

    expect(stone).toMatchObject({
      commits: undefined,
      dependency: [],
      description: undefined,
      id: "0001-deadbeef",
      major: [],
      message: "minimal stone",
      minor: [],
      patch: [],
      snapshot: [],
      tag: undefined,
    });
  });
});

describe("Stone.merge()", () => {
  test("merges two stones with non-overlapping packages", () => {
    const stoneA = Stone.create({ major: ["@app/core"], message: "stone A", minor: ["@app/utils"] });
    const stoneB = Stone.create({ dependency: ["@app/deps"], message: "stone B", patch: ["@app/cli"] });

    const { stone, conflicts } = Stone.merge([stoneA, stoneB], "merged");

    expect(conflicts).toEqual([]);
    expect(stone).toMatchObject({
      dependency: ["@app/deps"],
      major: ["@app/core"],
      message: "merged",
      minor: ["@app/utils"],
      patch: ["@app/cli"],
    });
  });

  test("detects conflicts when same package at different bump levels", () => {
    const stoneA = Stone.create({ message: "stone A", minor: ["@app/core"] });
    const stoneB = Stone.create({ message: "stone B", patch: ["@app/core"] });

    const { conflicts } = Stone.merge([stoneA, stoneB], "merged");

    expect(conflicts).toContain("@app/core");
  });

  test("resolves conflicts using higherBump (major wins over minor)", () => {
    const stoneA = Stone.create({ message: "stone A", minor: ["@app/core"] });
    const stoneB = Stone.create({ major: ["@app/core"], message: "stone B" });

    const { stone, conflicts } = Stone.merge([stoneA, stoneB], "merged");

    expect(conflicts).toContain("@app/core");
    expect(stone.major).toContain("@app/core");
    expect(stone.minor).not.toContain("@app/core");
  });

  test("BUG: drops Snapshot packages entirely during merge", () => {
    const stoneA = Stone.create({ message: "stone A", snapshot: ["@app/snapshot-pkg"] });
    const stoneB = Stone.create({ message: "stone B", patch: ["@app/cli"] });

    const { stone } = Stone.merge([stoneA, stoneB], "merged");

    expect(stone.snapshot).toEqual([]);
    expect(stone.allPackages).not.toContain("@app/snapshot-pkg");
  });

  test("merges descriptions from both stones", () => {
    const stoneA = Stone.create({ description: "Description A", message: "A" });
    const stoneB = Stone.create({ description: "Description B", message: "B" });

    const { stone } = Stone.merge([stoneA, stoneB], "merged");

    expect(stone.description).toBe("Description A\n\nDescription B");
  });

  test("deduplicates commits", () => {
    const commit1 = makeCommit("aaa1111", "first");
    const commit2 = makeCommit("bbb2222", "second");

    const stoneA = Stone.create({ commits: [commit1, commit2], message: "A" });
    const stoneB = Stone.create({ commits: [commit2], message: "B" });

    const { stone } = Stone.merge([stoneA, stoneB], "merged");

    const hashes = stone.commits?.map((c) => c.hash) ?? [];
    expect(hashes).toEqual(["aaa1111", "bbb2222", "bbb2222"]);
  });

  test("silently picks first tag when tags conflict", () => {
    const stoneA = Stone.create({ message: "A", tag: "v1.0.0" });
    const stoneB = Stone.create({ message: "B", tag: "v2.0.0" });

    const { stone, conflicts } = Stone.merge([stoneA, stoneB], "merged");

    expect(stone.tag).toBe("v1.0.0");
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
    const all = Stone.create(baseData).allPackages;

    expect(all).toEqual(expect.arrayContaining(["@app/core", "@app/utils", "@app/cli", "@app/deps", "@app/snapshot"]));
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
    const stone = Stone.create({ major: ["@app/core"], message: "only major" });

    expect(stone.getPackages(BumpType.Minor)).toEqual([]);
    expect(stone.getPackages(BumpType.Patch)).toEqual([]);
  });
});

describe("immutable update methods", () => {
  test("withMessage() returns new stone with updated message, original unchanged", () => {
    const original = Stone.create(baseData);
    const updated = original.withMessage("new message");

    expect(updated).toMatchObject({
      id: original.id,
      major: original.major,
      message: "new message",
      tag: original.tag,
    });
    expect(original.message).toBe("release v1.0.0");
  });

  test("withTag() returns new stone with updated tag, original unchanged", () => {
    const original = Stone.create(baseData);
    const updated = original.withTag("v2.0.0");

    expect(updated).toMatchObject({ id: original.id, tag: "v2.0.0" });
    expect(original.tag).toBe("v1.0.0");
  });

  test("withTag(undefined) clears the tag", () => {
    expect(Stone.create(baseData).withTag(undefined).tag).toBeUndefined();
  });

  test("withDescription() returns new stone with updated description, original unchanged", () => {
    const original = Stone.create(baseData);
    const updated = original.withDescription("Updated description");

    expect(updated).toMatchObject({ description: "Updated description", id: original.id });
    expect(original.description).toBe("Initial release");
  });

  test("withDescription(undefined) clears the description", () => {
    expect(Stone.create(baseData).withDescription(undefined).description).toBeUndefined();
  });
});

describe("toJson()", () => {
  test("omits empty arrays via nonEmpty helper", () => {
    const json = Stone.create({ major: ["@app/core"], message: "only major" }).toJson();

    expect(json).toMatchObject({ major: ["@app/core"] });
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
    const stone = Stone.create({ commits: [commit], message: "with commits" });
    const json = stone.toJson();

    expect(json.commits).toHaveLength(1);
    expect(json.commits?.[0]?.hash).toBe("abc1234");
  });
});
