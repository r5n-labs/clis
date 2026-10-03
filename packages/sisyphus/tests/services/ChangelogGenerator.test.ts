import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { BumpType } from "../../src/domain/BumpType";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import { ChangelogGenerator } from "../../src/services/ChangelogGenerator";

const WRITE_ONLY_MODE = 0o200;
const READ_WRITE_MODE = 0o600;

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

  test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "preserves unreadable existing history through generation failure and rollback",
    async () => {
      root = mkdtempSync(join(tmpdir(), "sisyphus-changelog-"));
      const path = join(root, "CHANGELOG.md");
      const original = "# Changelog\n\nExisting release\n";
      writeFileSync(path, original);
      chmodSync(path, WRITE_ONLY_MODE);
      const generator = new ChangelogGenerator({ ...SISYPHUS_DEFAULT_CONFIG.changelog, root: false });
      const pkg = new Package({
        file: join(root, "package.json"),
        name: "fixture",
        version: "1.0.0",
        newVersion: "1.0.1",
      });
      const stone = Stone.fromJson({ id: "0001-testtest", message: "ship it", patch: ["fixture"] });

      try {
        expect(() => readFileSync(path)).toThrow();
        await expect(generator.generate([stone], [pkg])).rejects.toMatchObject({ code: "EACCES" });
        await generator.rollback();
        expect(existsSync(path)).toBe(true);
        chmodSync(path, READ_WRITE_MODE);
        expect(readFileSync(path, "utf8")).toBe(original);
      } finally {
        if (existsSync(path)) chmodSync(path, READ_WRITE_MODE);
      }
    },
  );
});
