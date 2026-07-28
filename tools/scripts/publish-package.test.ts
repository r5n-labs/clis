import { describe, expect, test } from "bun:test";
import { parseArguments } from "./publish-package";

const USAGE_PATTERN = /Usage: bun \.\/publish-package\.ts \.\/packages\/hydra \[--dry-run\]/;

describe("parseArguments", () => {
  test("reads a package directory without the dry run flag", () => {
    expect(parseArguments(["./packages/hydra"])).toEqual({ dryRun: false, packageDir: "./packages/hydra" });
  });

  test("reads the dry run flag before or after the package directory", () => {
    expect(parseArguments(["--dry-run", "./packages/hydra"])).toEqual({ dryRun: true, packageDir: "./packages/hydra" });
    expect(parseArguments(["./packages/hydra", "--dry-run"])).toEqual({ dryRun: true, packageDir: "./packages/hydra" });
  });

  test("rejects a repeated dry run flag", () => {
    expect(() => parseArguments(["./packages/hydra", "--dry-run", "--dry-run"])).toThrow("Duplicate flag: --dry-run. ");
    expect(() => parseArguments(["--dry-run", "--dry-run"])).toThrow(USAGE_PATTERN);
  });

  test("rejects an unknown flag", () => {
    expect(() => parseArguments(["./packages/hydra", "--tag"])).toThrow("Unknown flag: --tag. ");
    expect(() => parseArguments(["-f"])).toThrow(USAGE_PATTERN);
  });

  test("rejects more than one package directory", () => {
    expect(() => parseArguments(["./packages/hydra", "./packages/sisyphus"])).toThrow(
      "Unexpected extra package: ./packages/sisyphus. ",
    );
    expect(() => parseArguments(["./packages/hydra", "--dry-run", "./packages/sisyphus"])).toThrow(USAGE_PATTERN);
  });

  test("rejects a missing package directory", () => {
    expect(() => parseArguments([])).toThrow("No package provided. ");
    expect(() => parseArguments(["--dry-run"])).toThrow(USAGE_PATTERN);
  });
});
