import { describe, expect, test } from "bun:test";

import { BUMP_ORDER, BumpType, compareBumps, higherBump } from "../../src/domain/BumpType";

describe("compareBumps", () => {
  test("Major > Minor returns positive", () => {
    expect(compareBumps(BumpType.Major, BumpType.Minor)).toBeGreaterThan(0);
  });

  test("Minor > Patch returns positive", () => {
    expect(compareBumps(BumpType.Minor, BumpType.Patch)).toBeGreaterThan(0);
  });

  test("Patch > Dependency returns positive", () => {
    expect(compareBumps(BumpType.Patch, BumpType.Dependency)).toBeGreaterThan(0);
  });

  test("Dependency > Snapshot returns positive", () => {
    expect(compareBumps(BumpType.Dependency, BumpType.Snapshot)).toBeGreaterThan(0);
  });

  test("same type returns 0", () => {
    expect(compareBumps(BumpType.Major, BumpType.Major)).toBe(0);
    expect(compareBumps(BumpType.Minor, BumpType.Minor)).toBe(0);
    expect(compareBumps(BumpType.Patch, BumpType.Patch)).toBe(0);
    expect(compareBumps(BumpType.Dependency, BumpType.Dependency)).toBe(0);
    expect(compareBumps(BumpType.Snapshot, BumpType.Snapshot)).toBe(0);
  });

  test("Minor < Major returns negative", () => {
    expect(compareBumps(BumpType.Minor, BumpType.Major)).toBeLessThan(0);
  });
});

describe("higherBump", () => {
  test("returns Major when Major vs Minor", () => {
    expect(higherBump(BumpType.Major, BumpType.Minor)).toBe(BumpType.Major);
  });

  test("returns Major when Minor vs Major (order independent)", () => {
    expect(higherBump(BumpType.Minor, BumpType.Major)).toBe(BumpType.Major);
  });

  test("equal bumps returns first argument", () => {
    expect(higherBump(BumpType.Patch, BumpType.Patch)).toBe(BumpType.Patch);
  });
});

describe("BUMP_ORDER", () => {
  test("contains all 5 types in priority order", () => {
    expect(BUMP_ORDER).toEqual([
      BumpType.Major,
      BumpType.Minor,
      BumpType.Patch,
      BumpType.Dependency,
      BumpType.Snapshot,
    ]);
  });
});
