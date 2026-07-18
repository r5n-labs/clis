import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import { WorkspaceScanner } from "../../src/services/WorkspaceScanner";
import { createWorkspaceFixture } from "../helpers/workspace";

describe("WorkspaceScanner.scan()", () => {
  const originalCwd = process.cwd();
  let root: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (root) rmSync(root, { force: true, recursive: true });
    root = undefined;
  });

  test("includes private packages so stones in all-private monorepos resolve", async () => {
    root = createWorkspaceFixture([
      { name: "@fixture/app", private: true },
      { name: "@fixture/lib", private: true },
    ]);
    process.chdir(root);

    const { packages, packageNames } = await WorkspaceScanner.scan();

    expect([...packageNames].sort()).toEqual(["@fixture/app", "@fixture/lib"]);
    expect(packages.get("@fixture/app")?.version).toBe("1.0.0");
    expect(packages.get("@fixture/lib")?.version).toBe("1.0.0");
  });

  test("Package.applyStone resolves every package of an all-private stone", async () => {
    root = createWorkspaceFixture([
      { name: "@fixture/app", private: true },
      { name: "@fixture/lib", private: true },
    ]);
    process.chdir(root);

    const { packages } = await WorkspaceScanner.scan();
    const stone = Stone.create({ message: "release", patch: ["@fixture/app", "@fixture/lib"] });
    const updated = Package.applyStone(stone, packages);

    expect(updated.map((pkg) => pkg.name).sort()).toEqual(["@fixture/app", "@fixture/lib"]);
    expect(updated.every((pkg) => pkg.newVersion === "1.0.1")).toBe(true);
  });

  test("filter narrows packageNames but keeps all packages resolvable", async () => {
    root = createWorkspaceFixture([
      { name: "@fixture/app", private: true },
      { name: "@fixture/lib", private: true },
    ]);
    process.chdir(root);

    const { packages, packageNames } = await WorkspaceScanner.scan({ filter: "app" });

    expect([...packageNames]).toEqual(["@fixture/app"]);
    expect(packages.has("@fixture/lib")).toBe(true);
  });
});
