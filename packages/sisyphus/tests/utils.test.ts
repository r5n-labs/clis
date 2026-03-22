import { describe, expect, test } from "bun:test";
import { Package } from "../src/domain/Package";
import {
  buildPackagePathMap,
  findAffectedPackages,
  findDependencyPackages,
} from "../src/utils";

const makePackage = (name: string, file: string, dependencyOf?: string[]) =>
  new Package({ name, file, dependencyOf, version: "1.0.0" });

describe("buildPackagePathMap", () => {
  test("maps package file paths to directory -> name pairs", () => {
    const packages = new Map<string, Package>([
      ["@scope/ui", makePackage("@scope/ui", "packages/ui/package.json")],
      ["@scope/core", makePackage("@scope/core", "packages/core/package.json")],
    ]);

    const result = buildPackagePathMap(packages);

    expect(result.get("packages/ui")).toBe("@scope/ui");
    expect(result.get("packages/core")).toBe("@scope/core");
    expect(result.size).toBe(2);
  });

  test("root package gets '.' as directory", () => {
    const packages = new Map<string, Package>([
      ["root", makePackage("root", "package.json")],
    ]);

    const result = buildPackagePathMap(packages);

    expect(result.get(".")).toBe("root");
  });

  test("handles backslashes (Windows paths)", () => {
    const packages = new Map<string, Package>([
      ["@scope/ui", makePackage("@scope/ui", "packages\\ui\\package.json")],
    ]);

    const result = buildPackagePathMap(packages);

    expect(result.get("packages/ui")).toBe("@scope/ui");
  });
});

describe("findAffectedPackages", () => {
  const packages = new Map<string, Package>([
    ["root", makePackage("root", "package.json")],
    ["@scope/ui", makePackage("@scope/ui", "packages/ui/package.json")],
    ["@scope/core", makePackage("@scope/core", "packages/core/package.json")],
  ]);
  const pathMap = buildPackagePathMap(packages);

  test("file in package dir matches that package", () => {
    const result = findAffectedPackages(["packages/ui/index.ts"], pathMap);

    expect(result.has("@scope/ui")).toBe(true);
  });

  test("file in nested subdir of package matches", () => {
    const result = findAffectedPackages(
      ["packages/core/src/deep/nested/file.ts"],
      pathMap,
    );

    expect(result.has("@scope/core")).toBe(true);
  });

  test("file at root matches root package when includeRoot=true", () => {
    const result = findAffectedPackages(["README.md"], pathMap, true);

    expect(result.has("root")).toBe(true);
  });

  test("file at root does NOT match when includeRoot=false", () => {
    const result = findAffectedPackages(["README.md"], pathMap, false);

    expect(result.has("root")).toBe(false);
  });

  /**
   * BUG: Root package is included for EVERY file regardless of path.
   *
   * When dir === ".", the condition `isRoot ? includeRoot : matchesPath`
   * evaluates to `true` whenever includeRoot is true, regardless of whether
   * the file actually belongs to the root package. This means every file
   * (even ones clearly inside a sub-package) will also mark the root as
   * affected when includeRoot=true.
   */
  test("BUG: root package is included for every file when includeRoot=true", () => {
    const result = findAffectedPackages(
      ["packages/ui/index.ts"],
      pathMap,
      true,
    );

    // The file is inside packages/ui, so only @scope/ui should match.
    // However, due to the bug, root is also included.
    expect(result.has("@scope/ui")).toBe(true);
    expect(result.has("root")).toBe(true); // bug: root should NOT be here
  });

  test("file matching no package is ignored", () => {
    const pathMapNoRoot = new Map<string, string>([
      ["packages/ui", "@scope/ui"],
    ]);

    const result = findAffectedPackages(
      ["some/other/path/file.ts"],
      pathMapNoRoot,
    );

    expect(result.size).toBe(0);
  });

  test("multiple files affecting different packages", () => {
    const result = findAffectedPackages(
      ["packages/ui/button.ts", "packages/core/utils.ts"],
      pathMap,
      false,
    );

    expect(result.has("@scope/ui")).toBe(true);
    expect(result.has("@scope/core")).toBe(true);
    expect(result.has("root")).toBe(false);
  });
});

describe("findDependencyPackages", () => {
  test("returns dependents not in selected list", () => {
    const packages = new Map<string, Package>([
      [
        "@scope/utils",
        makePackage("@scope/utils", "packages/utils/package.json", [
          "@scope/ui",
          "@scope/core",
        ]),
      ],
    ]);

    const result = findDependencyPackages(["@scope/utils"], packages);

    expect(result).toContain("@scope/ui");
    expect(result).toContain("@scope/core");
    expect(result).toHaveLength(2);
  });

  test("skips packages already in selectedNames", () => {
    const packages = new Map<string, Package>([
      [
        "@scope/utils",
        makePackage("@scope/utils", "packages/utils/package.json", [
          "@scope/ui",
          "@scope/core",
        ]),
      ],
    ]);

    const result = findDependencyPackages(
      ["@scope/utils", "@scope/ui"],
      packages,
    );

    expect(result).toContain("@scope/core");
    expect(result).not.toContain("@scope/ui");
    expect(result).toHaveLength(1);
  });

  test("returns empty when no dependencies", () => {
    const packages = new Map<string, Package>([
      [
        "@scope/ui",
        makePackage("@scope/ui", "packages/ui/package.json"),
      ],
    ]);

    const result = findDependencyPackages(["@scope/ui"], packages);

    expect(result).toEqual([]);
  });

  test("handles packages with no dependencyOf field", () => {
    const packages = new Map<string, Package>([
      [
        "@scope/ui",
        makePackage("@scope/ui", "packages/ui/package.json", undefined),
      ],
    ]);

    const result = findDependencyPackages(["@scope/ui"], packages);

    expect(result).toEqual([]);
  });
});
