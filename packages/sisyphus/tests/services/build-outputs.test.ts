import { describe, expect, test } from "bun:test";
import { Exit } from "@r5n/cli-core";
import { DEFAULT_BUILD_COMMAND } from "../../src/constants";
import {
  createBuildOutputMatcher,
  EMPTY_BUILD_OUTPUT_MATCHER,
  resolveBuildConfig,
} from "../../src/services/release/build-outputs";

describe("createBuildOutputMatcher", () => {
  test("matches nested paths under a package glob", () => {
    const matcher = createBuildOutputMatcher(["packages/*/dist/**"]);

    expect(matcher.isOutput("packages/foo/dist/index.js")).toBe(true);
    expect(matcher.isOutput("packages/foo/dist/types/index.d.ts")).toBe(true);
    expect(matcher.isOutput("packages/foo/distant.js")).toBe(false);
    expect(matcher.isOutput("packages/dist.js")).toBe(false);
  });

  test("treats a trailing slash as a directory glob", () => {
    const matcher = createBuildOutputMatcher(["dist/"]);

    expect(matcher.isOutput("dist/index.js")).toBe(true);
  });

  test("matches submodule-prefixed paths with a recursive glob", () => {
    const matcher = createBuildOutputMatcher(["**/dist/**"]);

    expect(matcher.isOutput("packages/foo/vendor/dep/dist/x.js")).toBe(true);
  });

  test("an empty pattern list never matches", () => {
    expect(createBuildOutputMatcher([])).toBe(EMPTY_BUILD_OUTPUT_MATCHER);
    expect(EMPTY_BUILD_OUTPUT_MATCHER.isOutput("anything")).toBe(false);
  });
});

describe("resolveBuildConfig", () => {
  test("defaults to the per-package build when no config is present", () => {
    expect(resolveBuildConfig(undefined).command).toEqual(DEFAULT_BUILD_COMMAND);
  });

  test("an explicitly empty command disables the per-package build", () => {
    expect(resolveBuildConfig({ command: [], outputs: [], root: [] }).command).toEqual([]);
  });

  test.each([["/abs/**"], ["../up/**"], ["./rel/**"], [""]])("rejects the output pattern %p", (pattern) => {
    expect(() => resolveBuildConfig({ command: [], outputs: [pattern], root: [["bun", "x"]] })).toThrow(Exit);
  });

  test("rejects an empty root command", () => {
    expect(() => resolveBuildConfig({ command: [], outputs: [], root: [[]] })).toThrow("Invalid release.build.root[0]");
  });

  test("rejects an empty argument", () => {
    expect(() => resolveBuildConfig({ command: ["bun", ""], outputs: [], root: [] })).toThrow(
      "Invalid release.build.command",
    );
  });

  test("rejects declared outputs with no build command at all", () => {
    expect(() => resolveBuildConfig({ command: [], outputs: ["dist/**"], root: [] })).toThrow(
      "release.build.outputs is declared but no build command runs",
    );
  });
});
