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

    test("pre-release with tag: 1.0.0 + minor + alpha => 1.0.0-alpha.1", () => {
      expect(VersionCalculator.bump("1.0.0", BumpType.Minor, "alpha")).toBe("1.0.0-alpha.1");
    });

    test("pre-release increment same tag: 1.0.0-alpha.1 + minor + alpha => 1.0.0-alpha.2", () => {
      expect(VersionCalculator.bump("1.0.0-alpha.1", BumpType.Minor, "alpha")).toBe("1.0.0-alpha.2");
    });

    test("pre-release new tag resets counter: 1.0.0-alpha.3 + minor + beta => 1.0.0-beta.1", () => {
      expect(VersionCalculator.bump("1.0.0-alpha.3", BumpType.Minor, "beta")).toBe("1.0.0-beta.1");
    });

    test("snapshot returns 0.0.0-nightly-<date> format", () => {
      const result = VersionCalculator.bump("1.2.3", BumpType.Snapshot);
      expect(result).toMatch(/^0\.0\.0-nightly-\d{14}$/);
    });

    test("snapshot with custom tag uses that tag", () => {
      const result = VersionCalculator.bump("1.2.3", BumpType.Snapshot, "canary");
      expect(result).toMatch(/^0\.0\.0-canary-\d{14}$/);
    });

    test("malformed version input produces partial NaN in output (known bug)", () => {
      const result = VersionCalculator.bump("invalid", BumpType.Patch);
      // "invalid".split(".") => ["invalid"], minor/patch default to "0"
      // Only major parses as NaN; minor and patch get default values
      expect(result).toBe("NaN.0.1");
    });

    test("empty string version produces partial NaN in output", () => {
      const result = VersionCalculator.bump("", BumpType.Patch);
      // "".split("-") => [""], then "".split(".") => [""]
      // parseInt("") => NaN for major, minor/patch default to "0"
      expect(result).toBe("NaN.0.1");
    });

    test("default case returns unchanged version for unknown bump type", () => {
      const result = VersionCalculator.bump("1.2.3", "unknown" as BumpType);
      expect(result).toBe("1.2.3");
    });

    test("dependency bump on pre-release preserves tag: 1.0.0-rc.2 + dependency => 1.0.0-rc.3", () => {
      expect(VersionCalculator.bump("1.0.0-rc.2", BumpType.Dependency)).toBe("1.0.0-rc.3");
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
      expect(result).toBe("pkg@2.0.0 => 2.0.0-beta.1 \u2728");
    });
  });
});
