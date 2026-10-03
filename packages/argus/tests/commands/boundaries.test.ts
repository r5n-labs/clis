import { expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, renameSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config/loader";
import { cli, fixture } from "../helpers";

const INVALID_CONFIG_ARGS = [["--config"], ["--config", ""], ["--config", "  "], ["--no-config"]];

test.each(["check", "run", "verify"])("%s rejects explicit invalid config before side effects", async (command) => {
  const f = fixture();
  f.write("value.gd", "func value():\n    return 1\n");
  expect((await cli(f.loaded.root, ["init"])).code).toBe(0);
  const state = join(f.loaded.root, ".argus");
  const path = join(state, "config.json");
  const original = readFileSync(path, "utf8");
  for (const invalid of INVALID_CONFIG_ARGS) {
    const args = command === "verify" ? [command, "--import", join(f.directory, "absent.json")] : [command];
    const result = await cli(f.loaded.root, [...args, ...invalid, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("--config requires");
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(join(state, "cache"))).toBe(false);
    expect(existsSync(join(state, "reports"))).toBe(false);
  }
  expect((await cli(f.loaded.root, ["check", "--json"])).code).toBe(0);
  expect((await cli(f.loaded.root, ["check", "--config", path, "--json"])).code).toBe(0);
});

test.each([
  ["check", "../other"],
  ["run", "limit", "1"],
  ["run", "--", "../other"],
  ["init", "../other"],
  ["verify", "../verdict.json"],
  ["config", "preset", "upgrade", "extra"],
])("rejects unsupported positional arguments: %j", async (...args) => {
  const f = fixture();
  const result = await cli(f.loaded.root, args);
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).toContain("Unexpected arguments:");
  expect(existsSync(join(f.loaded.root, ".argus"))).toBe(false);
});

test.each([
  ["check", "--base", ""],
  ["run", "--no-base"],
  ["verify", "--import", ""],
  ["verify", "--no-import"],
  ["init", "--root", ""],
  ["init", "--no-root"],
  ["init", "--config", ""],
  ["init", "--no-config"],
  ["report", "create", "--base", ""],
])("rejects explicit empty path or revision options: %j", async (...args) => {
  const f = fixture();
  const result = await cli(f.loaded.root, args);
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).toContain("requires a value");
  expect(existsSync(join(f.loaded.root, ".argus"))).toBe(false);
});

test("init rejects missing or non-directory roots before creating configuration state", async () => {
  const f = fixture();
  f.write("file.gd", "");
  for (const root of [join(f.directory, "missing"), join(f.loaded.root, "file.gd")]) {
    const result = await cli(f.loaded.root, ["init", "--root", root, "--config", f.loaded.path]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("existing directory");
    expect(existsSync(f.loaded.stateDir)).toBe(false);
  }
});

test("configuration can repair a moved root without weakening candidate validation", async () => {
  const f = fixture();
  expect((await cli(f.directory, ["init", "--root", f.loaded.root, "--config", f.loaded.path])).code).toBe(0);
  const moved = join(f.directory, "moved");
  renameSync(f.loaded.root, moved);
  const original = readFileSync(f.loaded.path, "utf8");
  const invalid = await cli(f.directory, ["config", "set", "root", "../missing", "--config", f.loaded.path]);
  expect(invalid.code).toBe(1);
  expect(readFileSync(f.loaded.path, "utf8")).toBe(original);
  const repaired = await cli(f.directory, ["config", "set", "root", "../moved", "--config", f.loaded.path]);
  expect(repaired.code).toBe(0);
  expect(loadConfig(f.loaded.path).root).toBe(realpathSync(moved));
  expect(loadConfig(f.loaded.path).config.root).toBe("../moved");
  expect((await cli(f.directory, ["check", "--config", f.loaded.path, "--json"])).code).toBe(0);
});
