import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "../src/config-manager";

const roots: string[] = [];
const PRIVATE_MODE = 0o600;
const MODE_MASK = 0o777;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "core-config-"));
  roots.push(root);
  return { path: join(root, "config.json"), root };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("ConfigManager", () => {
  test.each(["{broken", "null", "[]", '"text"'])("never overwrites invalid config %s", (content) => {
    const { path } = fixture();
    writeFileSync(path, content);
    const config = new ConfigManager(path, { profiles: {} });

    expect(config.get("profiles")).toEqual({});
    expect(() => config.set("profiles", { replacement: true })).toThrow("Cannot overwrite unreadable config");
    expect(() => config.save({ profiles: {} })).toThrow("Cannot overwrite unreadable config");
    expect(readFileSync(path, "utf8")).toBe(content);
  });

  test("saves complete JSON without changing file permissions or leaving temporary files", () => {
    const { path, root } = fixture();
    writeFileSync(path, '{"value":"before"}');
    chmodSync(path, PRIVATE_MODE);
    const config = new ConfigManager(path, { value: "default" });

    config.set("value", "after");

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ value: "after" });
    expect(statSync(path).mode & MODE_MASK).toBe(PRIVATE_MODE);
    expect(readdirSync(root)).toEqual(["config.json"]);
  });

  test("atomic saves preserve existing config symlinks", () => {
    const { path, root } = fixture();
    const target = join(root, "target.json");
    writeFileSync(target, '{"value":"before"}');
    symlinkSync(target, path);

    new ConfigManager(path, { value: "default" }).set("value", "after");

    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ value: "after" });
  });

  test("getAll and separate instances do not share nested defaults", () => {
    const { path } = fixture();
    const defaults = { profiles: { primary: { labels: ["initial"] } } };
    const config = new ConfigManager(path, defaults);
    const second = new ConfigManager(path, defaults);

    config.getAll().profiles.primary.labels.push("copy");
    expect(config.get("profiles").primary.labels).toEqual(["initial"]);
    config.get("profiles").primary.labels.push("local");
    expect(second.get("profiles").primary.labels).toEqual(["initial"]);
    expect(defaults.profiles.primary.labels).toEqual(["initial"]);
  });
});
