import { describe, expect, test } from "bun:test";
import { BumpType } from "../../src/domain/BumpType";
import { Package, type PackageJson } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import {
  collectDependents,
  type DependentsOptions,
  excludeIgnored,
  excludeIgnoredFromStone,
  isIgnoredPackage,
  isRangeInvalidated,
  orderForRelease,
} from "../../src/services/dependency-graph";

const ALL_KINDS: DependentsOptions["kinds"] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const PUBLISHED_KINDS: DependentsOptions["kinds"] = ["dependencies", "optionalDependencies", "peerDependencies"];

function makePackages(entries: PackageJson[]): Map<string, Package> {
  const packages = new Map<string, Package>();

  for (const entry of entries) {
    const dir = entry.name.split("/").pop();
    const pkg = Package.fromJson(entry, `packages/${dir}/package.json`);
    packages.set(pkg.name, pkg);
  }

  return packages;
}

function chain(specifier = "workspace:*"): Map<string, Package> {
  return makePackages([
    { name: "@app/a", version: "1.0.0" },
    { dependencies: { "@app/a": specifier }, name: "@app/b", version: "1.0.0" },
    { dependencies: { "@app/b": specifier }, name: "@app/c", version: "1.0.0" },
  ]);
}

describe("collectDependents", () => {
  test("propagates through the whole chain, not just direct dependents", () => {
    const result = collectDependents([{ bump: BumpType.Patch, name: "@app/a" }], chain(), { kinds: ALL_KINDS });

    expect(result).toEqual(["@app/b", "@app/c"]);
  });

  test("excludes packages that are already seeded", () => {
    const seeds = [
      { bump: BumpType.Patch, name: "@app/a" },
      { bump: BumpType.Minor, name: "@app/b" },
    ];

    expect(collectDependents(seeds, chain(), { kinds: ALL_KINDS })).toEqual(["@app/c"]);
  });

  test("reports a diamond dependent exactly once", () => {
    const packages = makePackages([
      { name: "@app/a", version: "1.0.0" },
      { dependencies: { "@app/a": "workspace:*" }, name: "@app/b", version: "1.0.0" },
      { dependencies: { "@app/a": "workspace:*" }, name: "@app/c", version: "1.0.0" },
      { dependencies: { "@app/b": "workspace:*", "@app/c": "workspace:*" }, name: "@app/d", version: "1.0.0" },
    ]);

    const result = collectDependents([{ bump: BumpType.Patch, name: "@app/a" }], packages, { kinds: ALL_KINDS });

    expect(result).toEqual(["@app/b", "@app/c", "@app/d"]);
  });

  test("terminates on a dependency cycle", () => {
    const packages = makePackages([
      { dependencies: { "@app/b": "workspace:*" }, name: "@app/a", version: "1.0.0" },
      { dependencies: { "@app/a": "workspace:*" }, name: "@app/b", version: "1.0.0" },
    ]);

    const result = collectDependents([{ bump: BumpType.Major, name: "@app/a" }], packages, { kinds: ALL_KINDS });

    expect(result).toEqual(["@app/b"]);
  });

  test("releases peer and optional dependents", () => {
    const packages = makePackages([
      { name: "@app/a", version: "1.0.0" },
      { name: "@app/peer", peerDependencies: { "@app/a": "workspace:*" }, version: "1.0.0" },
      { name: "@app/optional", optionalDependencies: { "@app/a": "workspace:*" }, version: "1.0.0" },
    ]);

    const result = collectDependents([{ bump: BumpType.Patch, name: "@app/a" }], packages, { kinds: PUBLISHED_KINDS });

    expect(result).toEqual(["@app/optional", "@app/peer"]);
  });

  test("skips dev-only dependents when devDependencies are not release bearing", () => {
    const packages = makePackages([
      { name: "@app/a", version: "1.0.0" },
      { devDependencies: { "@app/a": "workspace:*" }, name: "@app/b", version: "1.0.0" },
    ]);
    const seeds = [{ bump: BumpType.Patch, name: "@app/a" }];

    expect(collectDependents(seeds, packages, { kinds: PUBLISHED_KINDS })).toEqual([]);
    expect(collectDependents(seeds, packages, { kinds: ALL_KINDS })).toEqual(["@app/b"]);
  });

  test("never traverses through an ignored package", () => {
    const result = collectDependents([{ bump: BumpType.Patch, name: "@app/a" }], chain(), {
      ignore: ["@app/b"],
      kinds: ALL_KINDS,
    });

    expect(result).toEqual([]);
  });

  test("drops ignored seeds", () => {
    const result = collectDependents([{ bump: BumpType.Patch, name: "@app/b" }], chain(), {
      ignore: ["@app/b"],
      kinds: ALL_KINDS,
    });

    expect(result).toEqual([]);
  });

  test("ignores dependencies that are not workspace packages", () => {
    const packages = makePackages([
      { name: "@app/a", version: "1.0.0" },
      { dependencies: { "@app/a": "^1.0.0" }, name: "@app/b", version: "1.0.0" },
    ]);

    expect(collectDependents([{ bump: BumpType.Patch, name: "@app/a" }], packages, { kinds: ALL_KINDS })).toEqual([]);
  });

  test("outOfRange keeps caret dependents out of a patch release", () => {
    const packages = makePackages([
      { name: "@app/a", version: "1.2.3" },
      { dependencies: { "@app/a": "workspace:^" }, name: "@app/b", version: "1.0.0" },
    ]);

    const patch = collectDependents([{ bump: BumpType.Patch, name: "@app/a" }], packages, {
      kinds: ALL_KINDS,
      updateInternal: "outOfRange",
    });
    const major = collectDependents([{ bump: BumpType.Major, name: "@app/a" }], packages, {
      kinds: ALL_KINDS,
      updateInternal: "outOfRange",
    });

    expect(patch).toEqual([]);
    expect(major).toEqual(["@app/b"]);
  });

  test("always is the default and releases caret dependents regardless of range", () => {
    const packages = makePackages([
      { name: "@app/a", version: "1.2.3" },
      { dependencies: { "@app/a": "workspace:^" }, name: "@app/b", version: "1.0.0" },
    ]);

    expect(collectDependents([{ bump: BumpType.Patch, name: "@app/a" }], packages, { kinds: ALL_KINDS })).toEqual([
      "@app/b",
    ]);
  });
});

describe("isRangeInvalidated", () => {
  test("exact pins are invalidated by any change", () => {
    expect(isRangeInvalidated("workspace:*", "1.2.3", "1.2.4")).toBe(true);
    expect(isRangeInvalidated("workspace:*", "1.2.3", "1.2.3")).toBe(false);
  });

  test("caret admits minor and patch above 0.x", () => {
    expect(isRangeInvalidated("workspace:^", "1.2.3", "1.2.4")).toBe(false);
    expect(isRangeInvalidated("workspace:^", "1.2.3", "1.3.0")).toBe(false);
    expect(isRangeInvalidated("workspace:^", "1.2.3", "2.0.0")).toBe(true);
  });

  test("caret follows 0.x semantics", () => {
    expect(isRangeInvalidated("workspace:^", "0.1.2", "0.1.3")).toBe(false);
    expect(isRangeInvalidated("workspace:^", "0.1.2", "0.2.0")).toBe(true);
    expect(isRangeInvalidated("workspace:^", "0.0.3", "0.0.4")).toBe(true);
  });

  test("tilde admits patch only", () => {
    expect(isRangeInvalidated("workspace:~", "1.2.3", "1.2.4")).toBe(false);
    expect(isRangeInvalidated("workspace:~", "1.2.3", "1.3.0")).toBe(true);
  });

  test("prereleases on either side invalidate", () => {
    expect(isRangeInvalidated("workspace:^", "1.2.3", "1.3.0-beta.0")).toBe(true);
    expect(isRangeInvalidated("workspace:^", "1.2.3-beta.0", "1.2.3")).toBe(true);
  });

  test("literal ranges are never rewritten, so they never invalidate", () => {
    expect(isRangeInvalidated("workspace:>=1.0.0 <3", "1.2.3", "2.0.0")).toBe(false);
  });
});

describe("orderForRelease", () => {
  test("orders dependencies before dependents", () => {
    const packages = chain();
    const ordered = orderForRelease([
      packages.get("@app/c") as Package,
      packages.get("@app/a") as Package,
      packages.get("@app/b") as Package,
    ]);

    expect(ordered.ordered.map((pkg) => pkg.name)).toEqual(["@app/a", "@app/b", "@app/c"]);
    expect(ordered.cycle).toEqual([]);
  });

  test("sorts unrelated packages deterministically", () => {
    const packages = makePackages([
      { name: "@app/z", version: "1.0.0" },
      { name: "@app/a", version: "1.0.0" },
    ]);

    const ordered = orderForRelease([...packages.values()]);

    expect(ordered.ordered.map((pkg) => pkg.name)).toEqual(["@app/a", "@app/z"]);
  });

  test("reports the packages it had to force and still emits each exactly once", () => {
    const packages = makePackages([
      { dependencies: { "@app/b": "workspace:*" }, name: "@app/a", version: "1.0.0" },
      { dependencies: { "@app/a": "workspace:*" }, name: "@app/b", version: "1.0.0" },
    ]);

    const ordered = orderForRelease([...packages.values()]);

    expect(ordered.cycle).toEqual(["@app/a"]);
    expect(ordered.ordered.map((pkg) => pkg.name)).toEqual(["@app/a", "@app/b"]);
  });

  test("keeps satisfiable constraints when only part of the graph is cyclic", () => {
    const packages = makePackages([
      { dependencies: { "@app/z": "workspace:*" }, name: "@app/a", version: "1.0.0" },
      { dependencies: { "@app/y": "workspace:*" }, name: "@app/z", version: "1.0.0" },
      { dependencies: { "@app/z": "workspace:*" }, name: "@app/y", version: "1.0.0" },
    ]);

    const ordered = orderForRelease([...packages.values()]);

    expect(ordered.cycle).toEqual(["@app/z"]);
    expect(ordered.ordered.map((pkg) => pkg.name)).toEqual(["@app/z", "@app/a", "@app/y"]);
  });

  test("ignores dependencies outside the release set", () => {
    const packages = chain();
    const ordered = orderForRelease([packages.get("@app/c") as Package]);

    expect(ordered.ordered.map((pkg) => pkg.name)).toEqual(["@app/c"]);
    expect(ordered.cycle).toEqual([]);
  });
});

describe("isIgnoredPackage", () => {
  test("matches exact names", () => {
    expect(isIgnoredPackage("@app/a", ["@app/a"])).toBe(true);
    expect(isIgnoredPackage("@app/a", ["@app/b"])).toBe(false);
  });

  test("matches scoped globs", () => {
    expect(isIgnoredPackage("@internal/playground", ["@internal/*"])).toBe(true);
    expect(isIgnoredPackage("@app/a", ["@internal/*"])).toBe(false);
  });

  test("is false for an empty pattern list", () => {
    expect(isIgnoredPackage("@app/a", [])).toBe(false);
  });
});

describe("excludeIgnored", () => {
  test("splits a release set into kept and skipped", () => {
    const packages = [...chain().values()];
    const result = excludeIgnored(packages, ["@app/b"]);

    expect(result.kept.map((pkg) => pkg.name)).toEqual(["@app/a", "@app/c"]);
    expect(result.skipped).toEqual(["@app/b"]);
  });

  test("returns everything when nothing is ignored", () => {
    const packages = [...chain().values()];

    expect(excludeIgnored(packages, []).kept).toHaveLength(3);
  });
});

describe("excludeIgnoredFromStone", () => {
  test("strips ignored packages from every bump bucket", () => {
    const stone = Stone.create({
      dependency: ["@internal/playground"],
      major: ["@app/a"],
      message: "release",
      patch: ["@internal/tools"],
    });

    const result = excludeIgnoredFromStone(stone, ["@internal/*"]);

    expect(result.stone.major).toEqual(["@app/a"]);
    expect(result.stone.patch).toEqual([]);
    expect(result.stone.dependency).toEqual([]);
    expect(result.skipped).toEqual(["@internal/playground", "@internal/tools"]);
  });

  test("returns the same stone when nothing is ignored", () => {
    const stone = Stone.create({ major: ["@app/a"], message: "release" });

    expect(excludeIgnoredFromStone(stone, []).stone).toBe(stone);
  });
});

describe("isRangeInvalidated for 0.0.x carets", () => {
  test("a minor bump leaves a 0.0.x caret range", () => {
    expect(isRangeInvalidated("workspace:^", "0.0.0", "0.1.0")).toBe(true);
    expect(isRangeInvalidated("workspace:^", "0.0.3", "0.1.3")).toBe(true);
  });
});
