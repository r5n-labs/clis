import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Package } from "../../src/domain/Package";
import { PackageUpdater } from "../../src/services/PackageUpdater";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sisyphus-updater-"));
});
afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

async function updateManifest(content: string, newVersion: string): Promise<string> {
  const file = join(root, "package.json");
  writeFileSync(file, content);
  const manifest = JSON.parse(content);
  const pkg = new Package({ file, name: manifest.name ?? "fixture", version: manifest.version ?? "", newVersion });
  await new PackageUpdater().updateAll([pkg]);
  return readFileSync(file, "utf8");
}

describe("PackageUpdater", () => {
  test("preserves surrounding formatting exactly", async () => {
    const content = `{
  "bin": { "hydra": "dist/cli.js" },
  "files": ["dist", "LICENSE"],
  "name": "@r5n/hydra",
  "version": "0.8.0"
}
`;

    expect(await updateManifest(content, "0.9.0")).toBe(content.replace('"0.8.0"', '"0.9.0"'));
  });

  test("keeps tabs and compact single-line manifests intact", async () => {
    expect(await updateManifest('{"name":"x","version":"1.0.0"}', "1.0.1")).toBe('{"name":"x","version":"1.0.1"}');
    expect(await updateManifest('{\n\t"name": "x",\n\t"version": "1.0.0"\n}\n', "2.0.0")).toBe(
      '{\n\t"name": "x",\n\t"version": "2.0.0"\n}\n',
    );
  });

  test("ignores nested version fields", async () => {
    const content = `{
  "engines": {
    "version": "9.9.9"
  },
  "version": "1.0.0"
}
`;
    const updated = await updateManifest(content, "1.0.1");

    expect(updated).toContain('"version": "9.9.9"');
    expect(updated).toContain('"version": "1.0.1"');
  });

  test("ignores a version string inside an array", async () => {
    const content = `{
  "keywords": [
    "version"
  ],
  "version": "1.0.0"
}
`;

    expect(await updateManifest(content, "1.2.0")).toBe(content.replace('"1.0.0"', '"1.2.0"'));
  });

  test("ignores a dependency literally named version", async () => {
    const content = `{
  "dependencies": { "version": "^1.0.0" },
  "version": "0.1.0"
}
`;
    const updated = await updateManifest(content, "0.2.0");

    expect(updated).toContain('"dependencies": { "version": "^1.0.0" }');
    expect(updated).toContain('"version": "0.2.0"');
  });

  test("handles escaped characters in neighbouring values", async () => {
    const content = `{
  "description": "quote \\" and { brace",
  "version": "1.0.0"
}
`;

    expect(await updateManifest(content, "1.0.1")).toBe(content.replace('"1.0.0"', '"1.0.1"'));
  });

  test("inserts the version when no top-level version exists", async () => {
    const updated = await updateManifest('{\n  "name": "x"\n}\n', "1.0.0");

    expect(JSON.parse(updated)).toEqual({ name: "x", version: "1.0.0" });
  });

  test("produces valid JSON for every supported shape", async () => {
    const shapes = [
      '{"version":"1.0.0","name":"a"}',
      '{\n  "version": "1.0.0"\n}\n',
      '{\n  "a": { "b": [1, 2] },\n  "version": "1.0.0"\n}\n',
    ];

    for (const shape of shapes) {
      expect(JSON.parse(await updateManifest(shape, "3.4.5")).version).toBe("3.4.5");
    }
  });

  test.each([
    '{"name":"fixture","version":"0.0.1","version":"1.0.0"}\n',
    '{"name":"fixture","version":"0.0.1","versi\\u006fn":"1.0.0"}\n',
    '{"name":"fixture","versi\\u006fn":"0.0.1","version":"1.0.0"}\n',
  ])("updates the effective duplicate version and restores original bytes: %j", async (original) => {
    const file = join(root, "package.json");
    writeFileSync(file, original);
    const updater = new PackageUpdater();
    const pkg = new Package({ file, name: "fixture", version: "1.0.0", newVersion: "1.0.1" });

    await updater.updateAll([pkg]);

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ name: "fixture", version: "1.0.1" });
    await updater.rollback();
    expect(readFileSync(file, "utf8")).toBe(original);
  });
});
