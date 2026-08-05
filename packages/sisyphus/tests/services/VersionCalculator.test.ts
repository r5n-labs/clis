import { describe, expect, test } from "bun:test";
import { BumpType } from "../../src/domain/BumpType";
import { VersionCalculator } from "../../src/services/VersionCalculator";

describe("VersionCalculator", () => {
  describe("bump", () => {
    test("major bump resets minor and patch: 1.2.3 => 2.0.0", () => {
      expect(VersionCalculator.bump("1.2.3", BumpType.Major)).toBe("2.0.0");
    });

    test("minor bump resets patch: 1.2.3 => 1.3.0", () => {
      expect(VersionCalculator.bump("1.2.3", BumpType.Minor)).toBe("1.3.0");
    });

    test("patch bump increments patch: 1.2.3 => 1.2.4", () => {
      expect(VersionCalculator.bump("1.2.3", BumpType.Patch)).toBe("1.2.4");
    });

    test("dependency bump behaves like patch: 1.2.3 => 1.2.4", () => {
      expect(VersionCalculator.bump("1.2.3", BumpType.Dependency)).toBe("1.2.4");
    });

    test("major bump from 0.x: 0.1.0 => 1.0.0", () => {
      expect(VersionCalculator.bump("0.1.0", BumpType.Major)).toBe("1.0.0");
    });

    test("entering a pre-release bumps the base first: 1.0.0 + minor + alpha => 1.1.0-alpha.0", () => {
      expect(VersionCalculator.bump("1.0.0", BumpType.Minor, "alpha")).toBe("1.1.0-alpha.0");
    });

    test("pre-release increment same tag: 1.1.0-alpha.0 + minor + alpha => 1.1.0-alpha.1", () => {
      expect(VersionCalculator.bump("1.1.0-alpha.0", BumpType.Minor, "alpha")).toBe("1.1.0-alpha.1");
    });

    test("pre-release increment same tag: 1.0.0-alpha.1 + patch + alpha => 1.0.0-alpha.2", () => {
      expect(VersionCalculator.bump("1.0.0-alpha.1", BumpType.Patch, "alpha")).toBe("1.0.0-alpha.2");
    });

    test("a higher bump escalates the base: 1.1.0-alpha.1 + major + alpha => 2.0.0-alpha.0", () => {
      expect(VersionCalculator.bump("1.1.0-alpha.1", BumpType.Major, "alpha")).toBe("2.0.0-alpha.0");
    });

    test("pre-release new tag resets counter: 1.0.0-alpha.3 + minor + beta => 1.0.0-beta.0", () => {
      expect(VersionCalculator.bump("1.0.0-alpha.3", BumpType.Minor, "beta")).toBe("1.0.0-beta.0");
    });

    test("leaving a pre-release lands on the accumulated target: 1.1.0-beta.1 + patch => 1.1.0", () => {
      expect(VersionCalculator.bump("1.1.0-beta.1", BumpType.Patch)).toBe("1.1.0");
    });

    test("leaving a pre-release ignores a lower bump: 1.1.0-beta.1 + minor => 1.1.0", () => {
      expect(VersionCalculator.bump("1.1.0-beta.1", BumpType.Minor)).toBe("1.1.0");
    });

    test("a pre-release tag that moves backwards is rejected", () => {
      expect(() => VersionCalculator.bump("1.0.0-rc.3", BumpType.Patch, "alpha")).toThrow(
        "A patch bump would move 1.0.0-rc.3 to 1.0.0-alpha.0, which is not a later version",
      );
    });

    test("snapshot returns 0.0.0-nightly-<date> format", () => {
      const result = VersionCalculator.bump("1.2.3", BumpType.Snapshot);
      expect(result).toMatch(/^0\.0\.0-nightly-\d{14}$/);
    });

    test("snapshot with custom tag uses that tag", () => {
      const result = VersionCalculator.bump("1.2.3", BumpType.Snapshot, "canary");
      expect(result).toMatch(/^0\.0\.0-canary-\d{14}$/);
    });

    test.each(["invalid", "", "1.x.0", "v1.2.3", "1.2"])("malformed version %p is rejected", (version) => {
      expect(() => VersionCalculator.bump(version, BumpType.Patch)).toThrow("is not a valid version");
    });

    test("unknown bump type is rejected", () => {
      expect(() => VersionCalculator.bump("1.2.3", "unknown" as BumpType)).toThrow('Unknown bump type "unknown"');
    });

    test("a normal bump on a snapshot version is rejected", () => {
      expect(() => VersionCalculator.bump("0.0.0-nightly-20260805120000", BumpType.Patch)).toThrow(
        "Cannot apply a patch bump to snapshot version",
      );
    });

    test("build metadata is dropped by a bump", () => {
      expect(VersionCalculator.bump("1.2.3+build.5", BumpType.Patch)).toBe("1.2.4");
    });

    test("a non-canonical prerelease cannot be continued under the same tag", () => {
      expect(() => VersionCalculator.bump("1.0.0-alpha.beta.1", BumpType.Patch, "alpha")).toThrow(
        'Cannot continue the "alpha" prerelease from 1.0.0-alpha.beta.1',
      );
    });

    test("dependency bump inside a channel advances it: 1.0.0-rc.2 + dependency + rc => 1.0.0-rc.3", () => {
      expect(VersionCalculator.bump("1.0.0-rc.2", BumpType.Dependency, "rc")).toBe("1.0.0-rc.3");
    });

    test("an untagged dependency bump keeps an unrelated channel: 1.0.0-rc.2 => 1.0.0-rc.3", () => {
      expect(VersionCalculator.bump("1.0.0-rc.2", BumpType.Dependency)).toBe("1.0.0-rc.3");
    });

    test("a graduating release takes dependents out of the channel: 1.0.0-rc.2 => 1.0.0", () => {
      expect(VersionCalculator.bump("1.0.0-rc.2", BumpType.Dependency, undefined, true)).toBe("1.0.0");
    });

    test.each(["1.0.0-alpha", "1.0.0-alpha.beta.1"])(
      "refuses to silently graduate a non-canonical prerelease %p on an untagged dependency bump",
      (version) => {
        expect(() => VersionCalculator.bump(version, BumpType.Dependency)).toThrow(
          `Cannot continue the prerelease of ${version}`,
        );
      },
    );

    test("a graduating release still drops a non-canonical prerelease: 1.0.0-alpha => 1.0.0", () => {
      expect(VersionCalculator.bump("1.0.0-alpha", BumpType.Dependency, undefined, true)).toBe("1.0.0");
    });

    test.each(["beta.4", "", "with space", "beta/rc"])("rejects the prerelease tag %p", (tag) => {
      expect(() => VersionCalculator.bump("1.0.0", BumpType.Minor, tag)).toThrow("Invalid prerelease tag");
    });

    test("dependency bump without tag on non-prerelease acts as patch", () => {
      expect(VersionCalculator.bump("2.0.0", BumpType.Dependency)).toBe("2.0.1");
    });
  });

  describe("formatLabel", () => {
    test("formats label with name, versions, and emoji", () => {
      const result = VersionCalculator.formatLabel("my-pkg", "1.2.3", BumpType.Minor);
      expect(result).toBe("my-pkg@1.2.3 => 1.3.0 \u2728");
    });

    test("formats label for major bump with correct emoji", () => {
      const result = VersionCalculator.formatLabel("core", "0.5.0", BumpType.Major);
      expect(result).toBe("core@0.5.0 => 1.0.0 \uD83D\uDEA8");
    });

    test("formats label for patch bump with correct emoji", () => {
      const result = VersionCalculator.formatLabel("utils", "3.1.0", BumpType.Patch);
      expect(result).toBe("utils@3.1.0 => 3.1.1 \uD83D\uDC1B");
    });

    test("formats label for dependency bump with correct emoji", () => {
      const result = VersionCalculator.formatLabel("lib", "1.0.0", BumpType.Dependency);
      expect(result).toBe("lib@1.0.0 => 1.0.1 \uD83D\uDCE6");
    });

    test("formats label for snapshot bump with correct emoji", () => {
      const result = VersionCalculator.formatLabel("app", "1.0.0", BumpType.Snapshot);
      expect(result).toMatch(/^app@1\.0\.0 => 0\.0\.0-nightly-\d{14} \uD83D\uDCF8$/);
    });

    test("formats label with pre-release tag", () => {
      const result = VersionCalculator.formatLabel("pkg", "2.0.0", BumpType.Minor, "beta");
      expect(result).toBe("pkg@2.0.0 => 2.1.0-beta.0 \u2728");
    });
  });
});
