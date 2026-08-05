import { describe, expect, test } from "bun:test";
import { BumpType } from "../../src/domain/BumpType";
import { Package, type PackageJson } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import {
  buildReleasePrTitle,
  explainEmptyRelease,
  predictStoneVersions,
  stripIgnoredFromStones,
} from "../../src/services/release-plan";

const makePackages = (names: string[]) =>
  new Map(names.map((name) => [name, Package.fromJson({ name, version: "1.0.0" }, `packages/${name}/package.json`)]));

const packagesFromJson = (jsons: PackageJson[]) =>
  new Map(jsons.map((json) => [json.name, Package.fromJson(json, `packages/${json.name}/package.json`)]));

const makeReleasedPackage = (name: string, version: string, newVersion: string) =>
  new Package({ file: `packages/${name}/package.json`, name, newVersion, version });

describe("stripIgnoredFromStones", () => {
  test("strips ignored packages from every stone and reports them once", () => {
    const stones = [
      Stone.create({ message: "a", patch: ["@app/core", "@internal/x"] }),
      Stone.create({ dependency: ["@internal/x"], message: "b", minor: ["@app/cli"] }),
    ];

    const plan = stripIgnoredFromStones(stones, ["@internal/*"]);

    expect(plan.skipped).toEqual(["@internal/x"]);
    expect(plan.stones[0]?.patch).toEqual(["@app/core"]);
    expect(plan.stones[1]?.dependency).toEqual([]);
  });

  test("returns stones untouched with an empty ignore list", () => {
    const stones = [Stone.create({ message: "a", patch: ["@app/core"] })];

    expect(stripIgnoredFromStones(stones, []).stones[0]).toBe(stones[0] as Stone);
  });
});

describe("explainEmptyRelease", () => {
  test("names unknown packages that are not ignored", () => {
    const merged = Stone.create({ message: "m", patch: ["@app/gone", "@internal/x"] });

    const reason = explainEmptyRelease(merged, makePackages(["@app/core"]), ["@internal/*"]);

    expect(reason).toEqual({ kind: "unknown-packages", names: ["@app/gone"] });
  });

  test("reports ignored-only when every referenced package is ignored", () => {
    const merged = Stone.create({ message: "m", patch: ["@internal/x"] });

    expect(explainEmptyRelease(merged, makePackages(["@app/core"]), ["@internal/*"])).toEqual({ kind: "ignored-only" });
  });
});

describe("predictStoneVersions", () => {
  test("graduates prerelease dependents instead of continuing the prerelease channel", () => {
    const packages = packagesFromJson([
      { name: "@app/core", version: "1.0.0-beta.0" },
      { dependencies: { "@app/core": "workspace:^" }, name: "@app/cli", version: "1.0.0-beta.0" },
    ]);
    const stone = Stone.create({ dependency: ["@app/cli"], message: "m", patch: ["@app/core"] });

    const prediction = predictStoneVersions(stone, packages, []);

    expect(prediction).toEqual({
      kind: "ok",
      packages: [
        { bump: BumpType.Patch, name: "@app/core", newVersion: "1.0.0", version: "1.0.0-beta.0" },
        { bump: BumpType.Dependency, name: "@app/cli", newVersion: "1.0.0", version: "1.0.0-beta.0" },
      ],
    });
  });

  test("continues the prerelease for dependents when nothing graduates them", () => {
    const packages = packagesFromJson([{ name: "@app/cli", version: "1.0.0-beta.0" }]);
    const stone = Stone.create({ dependency: ["@app/cli"], message: "m" });

    const prediction = predictStoneVersions(stone, packages, []);

    expect(prediction).toEqual({
      kind: "ok",
      packages: [{ bump: BumpType.Dependency, name: "@app/cli", newVersion: "1.0.0-beta.1", version: "1.0.0-beta.0" }],
    });
  });

  test("strips ignored packages before predicting", () => {
    const packages = packagesFromJson([
      { name: "@app/core", version: "1.0.0" },
      { name: "@internal/x", version: "2.0.0" },
    ]);
    const stone = Stone.create({ message: "m", patch: ["@app/core", "@internal/x"] });

    const prediction = predictStoneVersions(stone, packages, ["@internal/*"]);

    expect(prediction).toEqual({
      kind: "ok",
      packages: [{ bump: BumpType.Patch, name: "@app/core", newVersion: "1.0.1", version: "1.0.0" }],
    });
  });

  test("reports an invalid manifest version instead of throwing", () => {
    const packages = packagesFromJson([{ name: "@app/bad", version: "not-a-version" }]);
    const stone = Stone.create({ message: "m", patch: ["@app/bad"] });

    const prediction = predictStoneVersions(stone, packages, []);

    expect(prediction.kind).toBe("invalid");
    if (prediction.kind === "invalid") {
      expect(prediction.message).toContain("not-a-version");
    }
  });
});

describe("buildReleasePrTitle", () => {
  test("joins every entry when at or under the cap", () => {
    const packages = [
      makeReleasedPackage("@app/core", "1.0.0", "1.1.0"),
      makeReleasedPackage("@app/cli", "2.0.0", "2.0.1"),
    ];

    expect(buildReleasePrTitle("chore(release):", packages)).toBe("chore(release): @app/core@1.1.0, @app/cli@2.0.1");
  });

  test("caps the title at six entries and counts the rest", () => {
    const packages = Array.from({ length: 9 }, (_, i) => makeReleasedPackage(`@app/p${i}`, "1.0.0", "1.1.0"));

    expect(buildReleasePrTitle("chore(release):", packages)).toBe(
      "chore(release): @app/p0@1.1.0, @app/p1@1.1.0, @app/p2@1.1.0, @app/p3@1.1.0, @app/p4@1.1.0, @app/p5@1.1.0 +3 more",
    );
  });

  test("exactly six entries has no overflow suffix", () => {
    const packages = Array.from({ length: 6 }, (_, i) => makeReleasedPackage(`@app/p${i}`, "1.0.0", "1.1.0"));

    expect(buildReleasePrTitle("chore(release):", packages)).not.toContain("more");
  });
});
