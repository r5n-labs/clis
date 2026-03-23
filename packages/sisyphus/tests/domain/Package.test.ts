import { describe, expect, test } from "bun:test";
import { BUMP_ORDER, BumpType } from "../../src/domain/BumpType";
import type { PackageJson } from "../../src/domain/Package";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";

const makePackage = (overrides?: Partial<PackageJson>, file = "packages/core/package.json"): Package =>
  Package.fromJson({ name: "@app/core", version: "1.2.3", ...overrides }, file);

/**
 * Applies bumps from a stone to matching packages — the pattern used
 * throughout sisyphus to connect stones with packages.
 */
function applyStone(packages: Package[], stone: Stone): Package[] {
  const result: Package[] = [];

  for (const pkg of packages) {
    let applied = false;
    for (const bump of BUMP_ORDER) {
      if (stone.getPackages(bump).includes(pkg.name)) {
        result.push(pkg.withBump(bump, stone.tag));
        applied = true;
        break;
      }
    }
    if (!applied) {
      result.push(pkg);
    }
  }

  return result;
}

describe("Package.fromJson()", () => {
  test("creates package with name, version, and file", () => {
    const json: PackageJson = { name: "@app/core", version: "1.2.3" };
    const pkg = Package.fromJson(json, "packages/core/package.json");

    expect(pkg.name).toBe("@app/core");
    expect(pkg.version).toBe("1.2.3");
    expect(pkg.file).toBe("packages/core/package.json");
    expect(pkg.bump).toBeUndefined();
    expect(pkg.dependencyOf).toEqual([]);
  });

  test("uses '0.0.0' for missing version", () => {
    const json: PackageJson = { name: "@app/core" };
    const pkg = Package.fromJson(json, "packages/core/package.json");

    expect(pkg.version).toBe("0.0.0");
  });

  test("uses '0.0.0' for empty string version", () => {
    const json: PackageJson = { name: "@app/core", version: "" };
    const pkg = Package.fromJson(json, "packages/core/package.json");

    expect(pkg.version).toBe("0.0.0");
  });

  test("handles private packages", () => {
    const json: PackageJson = { name: "@app/private", private: true, version: "0.1.0" };
    const pkg = Package.fromJson(json, "packages/private/package.json");

    expect(pkg.name).toBe("@app/private");
    expect(pkg.version).toBe("0.1.0");
  });
});

describe("package.withBump()", () => {
  test("returns new Package with bump set", () => {
    const original = makePackage();
    const bumped = original.withBump(BumpType.Minor);

    expect(bumped.bump).toBe(BumpType.Minor);
    expect(bumped.name).toBe(original.name);
    expect(bumped.version).toBe(original.version);
    expect(bumped.file).toBe(original.file);
    // original is unchanged (immutable)
    expect(original.bump).toBeUndefined();
  });

  test("preserves tag when provided", () => {
    const pkg = makePackage();
    const bumped = pkg.withBump(BumpType.Minor, "beta");

    expect(bumped.bump).toBe(BumpType.Minor);
    expect(bumped.tag).toBe("beta");
  });

  test("overwrites previous bump", () => {
    const pkg = makePackage();
    const minor = pkg.withBump(BumpType.Minor);
    const major = minor.withBump(BumpType.Major);

    expect(major.bump).toBe(BumpType.Major);
    expect(minor.bump).toBe(BumpType.Minor);
  });
});

describe("package.withDependencyOf()", () => {
  test("sets dependency list", () => {
    const pkg = makePackage();
    const updated = pkg.withDependencyOf(["@app/cli", "@app/web"]);

    expect(updated.dependencyOf).toEqual(["@app/cli", "@app/web"]);
    expect(pkg.dependencyOf).toEqual([]); // original unchanged
  });

  test("preserves other fields", () => {
    const pkg = makePackage().withBump(BumpType.Patch);
    const updated = pkg.withDependencyOf(["@app/cli"]);

    expect(updated.bump).toBe(BumpType.Patch);
    expect(updated.name).toBe("@app/core");
    expect(updated.version).toBe("1.2.3");
  });
});

describe("package.newVersion getter", () => {
  test("computes via VersionCalculator when bump is set", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Patch);
    expect(pkg.newVersion).toBe("1.2.4");
  });

  test("computes major bump correctly", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Major);
    expect(pkg.newVersion).toBe("2.0.0");
  });

  test("computes minor bump correctly", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Minor);
    expect(pkg.newVersion).toBe("1.3.0");
  });

  test("computes dependency bump as patch increment", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Dependency);
    expect(pkg.newVersion).toBe("1.2.4");
  });

  test("computes tagged bump correctly", () => {
    const pkg = makePackage({ version: "1.0.0" }).withBump(BumpType.Minor, "beta");
    expect(pkg.newVersion).toBe("1.0.0-beta.1");
  });

  test("returns undefined when no bump is set", () => {
    const pkg = makePackage();
    expect(pkg.newVersion).toBeUndefined();
  });
});

describe("package.label getter", () => {
  test("returns name@version when no bump set", () => {
    const pkg = makePackage({ version: "1.2.3" });
    expect(pkg.label).toBe("@app/core@1.2.3");
  });

  test("returns formatted string with version arrow and emoji for patch", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Patch);
    expect(pkg.label).toBe("@app/core@1.2.3 => 1.2.4 🐛");
  });

  test("returns formatted string with version arrow and emoji for major", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Major);
    expect(pkg.label).toBe("@app/core@1.2.3 => 2.0.0 🚨");
  });

  test("returns formatted string with version arrow and emoji for minor", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Minor);
    expect(pkg.label).toBe("@app/core@1.2.3 => 1.3.0 ✨");
  });

  test("returns formatted string with emoji for dependency bump", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Dependency);
    expect(pkg.label).toBe("@app/core@1.2.3 => 1.2.4 📦");
  });
});

describe("applyStone pattern — applying bumps from stone to matching packages", () => {
  test("applies bumps from stone to matching packages", () => {
    const packages = [
      makePackage({ name: "@app/core", version: "1.0.0" }),
      makePackage({ name: "@app/utils", version: "2.0.0" }),
    ];

    const stone = Stone.create({ major: ["@app/core"], message: "release", minor: ["@app/utils"] });

    const result = applyStone(packages, stone);

    expect(result[0]?.bump).toBe(BumpType.Major);
    expect(result[0]?.newVersion).toBe("2.0.0");
    expect(result[1]?.bump).toBe(BumpType.Minor);
    expect(result[1]?.newVersion).toBe("2.1.0");
  });

  test("respects BUMP_ORDER priority — major applied before minor for same package", () => {
    // If a package appears in both major and minor in a stone,
    // BUMP_ORDER iteration means major is checked first.
    const stone = Stone.create({
      major: ["@app/core"],
      message: "release",
      minor: ["@app/core"], // also listed in minor
    });

    const packages = [makePackage({ name: "@app/core", version: "1.0.0" })];
    const result = applyStone(packages, stone);

    // Major comes first in BUMP_ORDER, so major bump wins
    expect(result[0]?.bump).toBe(BumpType.Major);
    expect(result[0]?.newVersion).toBe("2.0.0");
  });

  test("ignores packages not in the stone", () => {
    const packages = [
      makePackage({ name: "@app/core", version: "1.0.0" }),
      makePackage({ name: "@app/unrelated", version: "3.0.0" }),
    ];

    const stone = Stone.create({ message: "release", patch: ["@app/core"] });

    const result = applyStone(packages, stone);

    expect(result[0]?.bump).toBe(BumpType.Patch);
    expect(result[0]?.newVersion).toBe("1.0.1");
    // Unrelated package is unchanged
    expect(result[1]?.bump).toBeUndefined();
    expect(result[1]?.newVersion).toBeUndefined();
  });
});
