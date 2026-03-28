import { describe, expect, test } from "bun:test";
import { Package } from "../src/domain/Package";
import { buildPackagePathMap, findAffectedPackages, findDependencyPackages } from "../src/utils";

const makePackage = (name: string, file: string, dependencyOf?: string[]) =>
  new Package({ dependencyOf, file, name, version: "1.0.0" });

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
    const packages = new Map<string, Package>([["root", makePackage("root", "package.json")]]);

    const result = buildPackagePathMap(packages);

    expect(result.get(".")).toBe("root");
  });

  test("handles backslashes (Windows paths)", () => {
    const packages = new Map<string, Package>([["@scope/ui", makePackage("@scope/ui", "packages\\ui\\package.json")]]);

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
    expect(findAffectedPackages(["packages/ui/index.ts"], pathMap)).toContain("@scope/ui");
  });

  test("file in nested subdir of package matches", () => {
    expect(findAffectedPackages(["packages/core/src/deep/nested/file.ts"], pathMap)).toContain("@scope/core");
  });

  test("file at root matches root package when includeRoot=true", () => {
    expect(findAffectedPackages(["README.md"], pathMap, true)).toContain("root");
  });

  test("file at root does NOT match when includeRoot=false", () => {
    expect(findAffectedPackages(["README.md"], pathMap, false)).not.toContain("root");
  });

  test("BUG: root package is included for every file when includeRoot=true", () => {
    const result = findAffectedPackages(["packages/ui/index.ts"], pathMap, true);

    expect(result).toContain("@scope/ui");
    expect(result).toContain("root");
  });

  test("file matching no package is ignored", () => {
    const pathMapNoRoot = new Map<string, string>([["packages/ui", "@scope/ui"]]);

    expect(findAffectedPackages(["some/other/path/file.ts"], pathMapNoRoot).size).toBe(0);
  });

  test("multiple files affecting different packages", () => {
    const result = findAffectedPackages(["packages/ui/button.ts", "packages/core/utils.ts"], pathMap, false);

    expect(result).toContain("@scope/ui");
    expect(result).toContain("@scope/core");
    expect(result).not.toContain("root");
  });
});

describe("findDependencyPackages", () => {
  test("returns dependents not in selected list", () => {
    const packages = new Map<string, Package>([
      ["@scope/utils", makePackage("@scope/utils", "packages/utils/package.json", ["@scope/ui", "@scope/core"])],
    ]);

    const result = findDependencyPackages(["@scope/utils"], packages);

    expect(result).toEqual(expect.arrayContaining(["@scope/ui", "@scope/core"]));
    expect(result).toHaveLength(2);
  });

  test("skips packages already in selectedNames", () => {
    const packages = new Map<string, Package>([
      ["@scope/utils", makePackage("@scope/utils", "packages/utils/package.json", ["@scope/ui", "@scope/core"])],
    ]);

    const result = findDependencyPackages(["@scope/utils", "@scope/ui"], packages);

    expect(result).toContain("@scope/core");
    expect(result).not.toContain("@scope/ui");
    expect(result).toHaveLength(1);
  });

  test("returns empty when no dependencies", () => {
    const packages = new Map<string, Package>([["@scope/ui", makePackage("@scope/ui", "packages/ui/package.json")]]);

    const result = findDependencyPackages(["@scope/ui"], packages);

    expect(result).toEqual([]);
  });

  test("handles packages with no dependencyOf field", () => {
    const packages = new Map<string, Package>([
      ["@scope/ui", makePackage("@scope/ui", "packages/ui/package.json", undefined)],
    ]);

    const result = findDependencyPackages(["@scope/ui"], packages);

    expect(result).toEqual([]);
  });
});
