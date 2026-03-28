import { describe, expect, test } from "bun:test";

import {
  BUMP_EMOJI,
  BUMP_ORDER,
  BUMP_PRIORITY,
  BumpType,
  compareBumps,
  higherBump,
  isBumpType,
} from "../../src/domain/BumpType";

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

describe("isBumpType", () => {
  test.each(["major", "minor", "patch", "dependency", "snapshot"])('returns true for valid value "%s"', (value) => {
    expect(isBumpType(value)).toBe(true);
  });

  test.each(["invalid", "", "Major", "MAJOR"])('returns false for invalid value "%s"', (value) => {
    expect(isBumpType(value)).toBe(false);
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

describe("BUMP_PRIORITY", () => {
  test("Major has highest priority (5)", () => {
    expect(BUMP_PRIORITY[BumpType.Major]).toBe(5);

    for (const type of [BumpType.Minor, BumpType.Patch, BumpType.Dependency, BumpType.Snapshot]) {
      expect(BUMP_PRIORITY[type]).toBeLessThan(BUMP_PRIORITY[BumpType.Major]);
    }
  });
});

describe("BUMP_EMOJI", () => {
  test("all types have a non-empty emoji string", () => {
    for (const type of Object.values(BumpType)) {
      expect(BUMP_EMOJI[type]).toMatch(/.+/);
    }
  });
});
