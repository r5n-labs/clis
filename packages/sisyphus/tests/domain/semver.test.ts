import { describe, expect, test } from "bun:test";
import { Exit } from "@r5n/cli-core";
import {
  compareSemver,
  formatSemver,
  hasSameCore,
  incrementSemver,
  isPrerelease,
  parseSemver,
  prereleaseCounter,
  prereleaseTag,
  requireSemver,
  type Semver,
  withPrerelease,
} from "../../src/domain/semver";

const parse = (version: string): Semver => requireSemver(version, "test");

describe("parseSemver", () => {
  test.each([
    ["1.2.3", { build: [], major: 1, minor: 2, patch: 3, prerelease: [] }],
    ["0.0.0", { build: [], major: 0, minor: 0, patch: 0, prerelease: [] }],
    ["1.0.0-beta.1", { build: [], major: 1, minor: 0, patch: 0, prerelease: ["beta", 1] }],
    ["1.2.3+build.5", { build: ["build", "5"], major: 1, minor: 2, patch: 3, prerelease: [] }],
    ["1.2.3-rc.1+meta", { build: ["meta"], major: 1, minor: 2, patch: 3, prerelease: ["rc", 1] }],
  ])("parses %s", (version, expected) => {
    expect(parseSemver(version)).toEqual(expected);
  });

  test.each(["", "invalid", "1.x.0", "v1.2.3", "1.2", "1.2.3.4", "01.2.3", "1.2.3-", "1.2.3-beta..0", " 1.2.3"])(
    "rejects %p",
    (version) => {
      expect(parseSemver(version)).toBeNull();
    },
  );

  test("round-trips through formatSemver", () => {
    for (const version of ["1.2.3", "1.0.0-beta.1", "1.2.3+build.5", "1.2.3-rc.1+meta"]) {
      expect(formatSemver(parse(version))).toBe(version);
    }
  });
});

describe("requireSemver", () => {
  test("throws an actionable Exit for invalid input", () => {
    expect(() => requireSemver("nope", "apply a patch bump")).toThrow(Exit);
    expect(() => requireSemver("nope", "apply a patch bump")).toThrow(
      'Cannot apply a patch bump: "nope" is not a valid version',
    );
  });
});

describe("compareSemver", () => {
  test("follows the semver precedence chain", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.0.1",
      "1.1.0",
      "2.0.0",
    ];

    for (let index = 1; index < chain.length; index += 1) {
      const previous = parse(chain[index - 1] as string);
      const current = parse(chain[index] as string);
      expect(compareSemver(previous, current)).toBe(-1);
      expect(compareSemver(current, previous)).toBe(1);
    }
  });

  test("ignores build metadata", () => {
    expect(compareSemver(parse("1.2.3+a"), parse("1.2.3+b"))).toBe(0);
  });
});

describe("incrementSemver", () => {
  test.each([
    ["1.2.3", "major", "2.0.0"],
    ["1.2.3", "minor", "1.3.0"],
    ["1.2.3", "patch", "1.2.4"],
    ["1.1.0-beta.0", "patch", "1.1.0"],
    ["1.1.0-beta.0", "minor", "1.1.0"],
    ["1.1.0-beta.0", "major", "2.0.0"],
    ["2.0.0-beta.0", "major", "2.0.0"],
    ["2.0.0-beta.0", "minor", "2.0.0"],
    ["1.2.3-beta.0", "minor", "1.3.0"],
    ["1.2.3+build", "patch", "1.2.4"],
  ] as const)("%s + %s => %s", (version, release, expected) => {
    expect(formatSemver(incrementSemver(parse(version), release))).toBe(expected);
  });
});

describe("prerelease helpers", () => {
  test("reads the canonical tag and counter", () => {
    expect(prereleaseTag(parse("1.0.0-beta.3"))).toBe("beta");
    expect(prereleaseCounter(parse("1.0.0-beta.3"))).toBe(3);
  });

  test("rejects non-canonical prerelease shapes", () => {
    expect(prereleaseTag(parse("1.0.0-alpha.beta.1"))).toBeUndefined();
    expect(prereleaseCounter(parse("1.0.0-alpha"))).toBeUndefined();
    expect(prereleaseTag(parse("1.0.0"))).toBeUndefined();
  });

  test("withPrerelease drops build metadata", () => {
    expect(formatSemver(withPrerelease(parse("1.2.3+build"), "beta", 0))).toBe("1.2.3-beta.0");
  });

  test("isPrerelease and hasSameCore", () => {
    expect(isPrerelease(parse("1.0.0-beta.0"))).toBe(true);
    expect(isPrerelease(parse("1.0.0"))).toBe(false);
    expect(hasSameCore(parse("1.0.0-beta.0"), parse("1.0.0"))).toBe(true);
    expect(hasSameCore(parse("1.1.0"), parse("1.0.0"))).toBe(false);
  });
});
