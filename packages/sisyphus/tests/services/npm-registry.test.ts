import { describe, expect, test } from "bun:test";
import { Package } from "../../src/domain/Package";
import { resolveReleaseNpmTag } from "../../src/services/release/npm-registry";

function makePackage(name: string, newVersion: string, isPrivate = false): Package {
  return new Package({ file: `packages/${name}/package.json`, isPrivate, name, newVersion, version: "1.0.0" });
}

describe("resolveReleaseNpmTag", () => {
  test("uses the configured tag for a stable release", () => {
    expect(resolveReleaseNpmTag([makePackage("a", "1.1.0")], "latest")).toBe("latest");
  });

  test("derives the dist-tag from a prerelease version", () => {
    expect(resolveReleaseNpmTag([makePackage("a", "1.1.0-beta.0")], "latest")).toBe("beta");
  });

  test("derives the dist-tag from a snapshot version", () => {
    expect(resolveReleaseNpmTag([makePackage("a", "0.0.0-nightly-20260805120000")], "latest")).toBe("nightly");
  });

  test("keeps one tag when every package shares the channel", () => {
    const packages = [makePackage("a", "1.1.0-rc.0"), makePackage("b", "2.0.0-rc.3")];

    expect(resolveReleaseNpmTag(packages, "latest")).toBe("rc");
  });

  test("rejects a release that mixes stable and prerelease packages", () => {
    const packages = [makePackage("a", "1.1.0"), makePackage("b", "2.0.0-beta.0")];

    expect(() => resolveReleaseNpmTag(packages, "latest")).toThrow("Release mixes npm dist-tags");
  });

  test("ignores private packages when deriving the tag", () => {
    const packages = [makePackage("a", "1.1.0"), makePackage("b", "2.0.0-beta.0", true)];

    expect(resolveReleaseNpmTag(packages, "latest")).toBe("latest");
  });

  test("falls back to the configured tag when nothing is publishable", () => {
    expect(resolveReleaseNpmTag([makePackage("a", "1.1.0-beta.0", true)], "next")).toBe("next");
  });
});
