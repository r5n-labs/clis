import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunPackageBuilder } from "./index";

let originalCwd: string;
let fixture: string;

beforeEach(() => {
  originalCwd = process.cwd();
  fixture = mkdtempSync(join(tmpdir(), "r5n-builder-"));
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify({ name: "builder-fixture", scripts: { "type-check": "bun --version" } }),
  );
  writeFileSync(join(fixture, "input.ts"), 'console.log("built");\n');
  process.chdir(fixture);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(fixture, { force: true, recursive: true });
});

describe("bunPackageBuilder", () => {
  test("builds explicit entrypoints without package exports", async () => {
    await expect(bunPackageBuilder({ entrypoints: ["./input.ts"] })).resolves.toBe(true);
    expect(await Bun.file(join(fixture, "dist/input.js")).text()).toContain("built");
  });

  test("reports missing entrypoints without a manifest TypeError", async () => {
    await expect(bunPackageBuilder({})).rejects.toThrow("No entrypoints provided for build");
  });

  test("updates URL-encoded bundle size badges", async () => {
    writeFileSync(join(fixture, "README.md"), "![size](https://img.shields.io/badge/bundle%20size-~123KB-green.svg)\n");
    await bunPackageBuilder({ entrypoints: ["./input.ts"], updateReadme: true });
    const readme = await Bun.file(join(fixture, "README.md")).text();
    expect(readme).toContain("bundle_size-");
    expect(readme).not.toContain("123KB");
  });

  test("lets callers handle type-check failures", async () => {
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ scripts: { "type-check": "exit 1" } }));
    await expect(bunPackageBuilder({ entrypoints: ["./input.ts"] })).rejects.toThrow("Type check failed");
  });
});
