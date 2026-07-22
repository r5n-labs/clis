import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { BumpType } from "../../src/domain/BumpType";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import { ChangelogGenerator } from "../../src/services/ChangelogGenerator";

describe("ChangelogGenerator rollback", () => {
  const originalCwd = process.cwd();
  let root: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (root) rmSync(root, { force: true, recursive: true });
    root = undefined;
  });

  test("preserves the first snapshot when root and package changelogs are the same file", async () => {
    root = mkdtempSync(join(tmpdir(), "sisyphus-changelog-"));
    process.chdir(root);

    const original = "# Changelog\n\nExisting release\n";
    writeFileSync("CHANGELOG.md", original);
    writeFileSync("package.json", '{"name":"fixture","version":"1.0.0"}\n');

    const config = { ...SISYPHUS_DEFAULT_CONFIG.changelog, root: true };
    const generator = new ChangelogGenerator(config);
    const pkg = new Package({ bump: BumpType.Patch, file: "package.json", name: "fixture", version: "1.0.0" });
    const stone = Stone.fromJson({ id: "0001-testtest", message: "ship it", patch: ["fixture"] });

    await generator.generate([stone], [pkg]);
    expect(readFileSync("CHANGELOG.md", "utf-8")).not.toBe(original);

    await generator.rollback();
    expect(readFileSync("CHANGELOG.md", "utf-8")).toBe(original);
  });
});
