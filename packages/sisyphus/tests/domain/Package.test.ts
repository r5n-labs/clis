import { describe, expect, test } from "bun:test";
import { BumpType } from "../../src/domain/BumpType";
import type { PackageJson } from "../../src/domain/Package";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";

const makePackage = (overrides?: Partial<PackageJson>, file = "packages/core/package.json"): Package =>
  Package.fromJson({ name: "@app/core", version: "1.2.3", ...overrides }, file);

describe("Package.fromJson()", () => {
  test("creates package with name, version, and file", () => {
    const pkg = Package.fromJson({ name: "@app/core", version: "1.2.3" }, "packages/core/package.json");

    expect(pkg).toMatchObject({
      bump: undefined,
      file: "packages/core/package.json",
      name: "@app/core",
      version: "1.2.3",
      workspaceDependencies: [],
    });
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

  test("preserves isPrivate through withBump and withVersions", () => {
    const pkg = makePackage({ private: true });

    expect(pkg.isPrivate).toBe(true);
    expect(pkg.withBump(BumpType.Patch).isPrivate).toBe(true);
    expect(pkg.withBump(BumpType.Patch).withVersions("1.2.3", "1.2.4").isPrivate).toBe(true);
    expect(makePackage().isPrivate).toBe(false);
  });
});

describe("package.withBump()", () => {
  test("returns new Package with bump set, original unchanged", () => {
    const original = makePackage();
    const bumped = original.withBump(BumpType.Minor);

    expect(bumped).toMatchObject({
      bump: BumpType.Minor,
      file: original.file,
      name: original.name,
      version: original.version,
    });
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

describe("package.workspaceDependencies", () => {
  test("collects workspace edges from every manifest section", () => {
    const pkg = makePackage({
      dependencies: { "@app/runtime": "workspace:*", external: "^1.0.0" },
      devDependencies: { "@app/tools": "workspace:^" },
      optionalDependencies: { "@app/optional": "workspace:~" },
      peerDependencies: { "@app/peer": "workspace:>=1.0.0" },
    });

    expect(pkg.workspaceDependencies).toEqual([
      { kind: "dependencies", name: "@app/runtime", specifier: "workspace:*" },
      { kind: "devDependencies", name: "@app/tools", specifier: "workspace:^" },
      { kind: "optionalDependencies", name: "@app/optional", specifier: "workspace:~" },
      { kind: "peerDependencies", name: "@app/peer", specifier: "workspace:>=1.0.0" },
    ]);
  });

  test("ignores specifiers that only look like the workspace protocol", () => {
    const pkg = makePackage({ dependencies: { "@app/other": "workspaceish:1.0.0" } });

    expect(pkg.workspaceDependencies).toEqual([]);
  });

  test("survives withBump", () => {
    const pkg = makePackage({ dependencies: { "@app/runtime": "workspace:*" } }).withBump(BumpType.Patch);

    expect(pkg.workspaceDependencies).toHaveLength(1);
    expect(pkg).toMatchObject({ bump: BumpType.Patch, name: "@app/core", version: "1.2.3" });
  });
});

describe("package.newVersion getter", () => {
  test("computes via VersionCalculator when bump is set", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Patch);
    expect(pkg.newVersion).toBe("1.2.4");
  });

  test("computes tagged bump correctly", () => {
    const pkg = makePackage({ version: "1.0.0" }).withBump(BumpType.Minor, "beta");
    expect(pkg.newVersion).toBe("1.1.0-beta.0");
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

  test("uses the pinned newVersion instead of recomputing it", () => {
    const pkg = makePackage({ version: "1.2.3" }).withBump(BumpType.Patch).withVersions("1.2.3", "9.9.9");
    expect(pkg.label).toBe("@app/core@1.2.3 => 9.9.9 🐛");
  });

  test("uses the pinned snapshot version so previews cannot drift across time", () => {
    const pkg = new Package({
      bump: BumpType.Snapshot,
      file: "packages/core/package.json",
      name: "@app/core",
      newVersion: "0.0.0-nightly-20260101000000",
      version: "0.0.0",
    });
    expect(pkg.label).toBe("@app/core@0.0.0 => 0.0.0-nightly-20260101000000 📸");
  });
});

describe("Package.applyStone()", () => {
  const packages = (entries: PackageJson[]) =>
    new Map(entries.map((entry) => [entry.name, Package.fromJson(entry, `packages/${entry.name}/package.json`)]));

  const versionsOnly = (versions: Record<string, string>) =>
    packages(Object.entries(versions).map(([name, version]) => ({ name, version })));

  test("returns only selected known packages with their requested bumps", () => {
    const stone = Stone.create({ major: ["@app/core", "@app/missing"], message: "release", minor: ["@app/utils"] });
    const applied = Package.applyStone(
      stone,
      versionsOnly({ "@app/core": "1.0.0", "@app/unrelated": "3.0.0", "@app/utils": "2.0.0" }),
    );

    expect(applied.map(({ name, bump, newVersion }) => ({ bump, name, newVersion }))).toEqual([
      { bump: BumpType.Major, name: "@app/core", newVersion: "2.0.0" },
      { bump: BumpType.Minor, name: "@app/utils", newVersion: "2.1.0" },
    ]);
  });

  test("applies the highest requested bump once per package", () => {
    const stone = Stone.create({
      major: ["@app/core", "@app/core"],
      message: "release",
      minor: ["@app/core"],
      patch: ["@app/core"],
    });
    const applied = Package.applyStone(stone, versionsOnly({ "@app/core": "1.0.0" }));

    expect(applied.map(({ name, bump, newVersion }) => ({ bump, name, newVersion }))).toEqual([
      { bump: BumpType.Major, name: "@app/core", newVersion: "2.0.0" },
    ]);
  });

  test("dependents leave the channel when the release itself graduates", () => {
    const stone = Stone.create({ dependency: ["@app/cli"], message: "ship", patch: ["@app/core"] });
    const applied = Package.applyStone(
      stone,
      packages([
        { name: "@app/core", version: "2.0.0-beta.0" },
        { dependencies: { "@app/core": "workspace:*" }, name: "@app/cli", version: "1.0.2-beta.3" },
      ]),
    );

    expect(applied.map((pkg) => pkg.newVersion)).toEqual(["2.0.0", "1.0.2"]);
  });

  test("an unrelated graduating package does not graduate an independent prerelease dependent", () => {
    const stone = Stone.create({
      dependency: ["@app/ui-z"],
      major: ["@app/lib-x"],
      message: "ship",
      patch: ["@app/app-y"],
    });
    const applied = Package.applyStone(
      stone,
      packages([
        { name: "@app/lib-x", version: "2.0.0-beta.3" },
        { name: "@app/app-y", version: "1.0.0" },
        { dependencies: { "@app/app-y": "workspace:*" }, name: "@app/ui-z", version: "4.0.0-alpha.1" },
      ]),
    );

    const byName = new Map(applied.map((pkg) => [pkg.name, pkg.newVersion]));

    expect(byName.get("@app/lib-x")).toBe("2.0.0");
    expect(byName.get("@app/app-y")).toBe("1.0.1");
    expect(byName.get("@app/ui-z")).toBe("4.0.0-alpha.2");
  });

  test("excluded development edges cannot graduate a prerelease dependent", () => {
    const stone = Stone.create({ dependency: ["@app/cli"], message: "ship", patch: ["@app/core", "@app/tools"] });
    const applied = Package.applyStone(
      stone,
      packages([
        { name: "@app/core", version: "1.0.0" },
        { name: "@app/tools", version: "1.0.0-beta.2" },
        {
          dependencies: { "@app/core": "workspace:*" },
          devDependencies: { "@app/tools": "workspace:*" },
          name: "@app/cli",
          version: "2.0.0-beta.3",
        },
      ]),
      ["dependencies", "optionalDependencies", "peerDependencies"],
    );

    expect(applied.find((pkg) => pkg.name === "@app/cli")?.newVersion).toBe("2.0.0-beta.4");
  });

  test("graduation propagates transitively through prerelease dependents", () => {
    const stone = Stone.create({ dependency: ["@app/b", "@app/c"], message: "ship", minor: ["@app/a"] });
    const applied = Package.applyStone(
      stone,
      packages([
        { name: "@app/a", version: "1.1.0-beta.2" },
        { dependencies: { "@app/a": "workspace:*" }, name: "@app/b", version: "2.0.0-beta.5" },
        { dependencies: { "@app/b": "workspace:*" }, name: "@app/c", version: "3.0.0-rc.1" },
      ]),
    );

    const byName = new Map(applied.map((pkg) => [pkg.name, pkg.newVersion]));

    expect(byName.get("@app/a")).toBe("1.1.0");
    expect(byName.get("@app/b")).toBe("2.0.0");
    expect(byName.get("@app/c")).toBe("3.0.0");
  });

  test("dependents keep an unrelated channel when the release is plain stable", () => {
    const stone = Stone.create({ dependency: ["@app/cli"], message: "ship", patch: ["@app/core"] });
    const applied = Package.applyStone(stone, versionsOnly({ "@app/cli": "2.0.0-rc.3", "@app/core": "1.0.0" }));

    expect(applied.map((pkg) => pkg.newVersion)).toEqual(["1.0.1", "2.0.0-rc.4"]);
  });

  test("a tagged release puts every package on the channel", () => {
    const stone = Stone.create({ dependency: ["@app/cli"], message: "ship", patch: ["@app/core"], tag: "beta" });
    const applied = Package.applyStone(stone, versionsOnly({ "@app/cli": "1.0.1", "@app/core": "1.0.0" }));

    expect(applied.map((pkg) => pkg.newVersion)).toEqual(["1.0.1-beta.0", "1.0.2-beta.0"]);
  });
});
