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

  test("preserves mixed JSON formatting when changing nested values and clearing arrays", () => {
    const { path } = fixture();
    const content = `{
  "release": { "build": ["bun", "run", "build"], "push": true },
  "lastStone": { "commit": "before", "date": "yesterday" },
  "stones": [
    "0001-first",
    "0002-second"
  ]
}
`;
    writeFileSync(path, content);
    const config = new ConfigManager(path, { lastStone: { commit: "", date: "" }, stones: [] as string[] });

    config.set("stones", []);
    config.set("lastStone", { commit: "after", date: "today" });

    expect(readFileSync(path, "utf8")).toBe(
      content
        .replace('[\n    "0001-first",\n    "0002-second"\n  ]', "[]")
        .replace('"before"', '"after"')
        .replace('"yesterday"', '"today"'),
    );
  });

  test.each([
    '{"value":"before","nested":{"items":[1,2]}}',
    '{ "value": "before", "nested": { "items": [1, 2] } }\n',
    '{\r\n\t"value": "before",\r\n\t"nested": { "items": [1, 2] }\r\n}\r\n',
    '{\n    "value": "before",\n    "nested": { "items": [1, 2] }\n}\n\n',
  ])("preserves whitespace and line endings in %j", (content) => {
    const { path } = fixture();
    writeFileSync(path, content);

    new ConfigManager(path, { value: "default" }).set("value", "after");

    expect(readFileSync(path, "utf8")).toBe(content.replace('"before"', '"after"'));
  });

  test("preserves escaped keys, strings and numeric spelling during an unrelated update", () => {
    const { path } = fixture();
    const content = String.raw`{"\u0076alue":"before","text":"a \"quote\", } and \\ slash","number":1e2}`;
    writeFileSync(path, content);

    new ConfigManager(path, { value: "default" }).set("value", "after");

    expect(readFileSync(path, "utf8")).toBe(content.replace('"before"', '"after"'));
  });

  test("retains existing entries when adding defaults and deleting properties", () => {
    const { path } = fixture();
    writeFileSync(path, '{\n\t"nested": { "items": [1, 2] },\n\t"obsolete": true\n}\n');
    const config = new ConfigManager<{ enabled: boolean; obsolete?: boolean }>(path, { enabled: false });

    config.delete("obsolete");

    expect(readFileSync(path, "utf8")).toBe('{\n\t"nested": { "items": [1, 2] },\n\t"enabled": false\n}\n');
    config.save();
    expect(readFileSync(path, "utf8")).toBe('{\n\t"nested": { "items": [1, 2] },\n\t"enabled": false\n}\n');
  });

  test("new config files end with a newline", () => {
    const { path } = fixture();

    new ConfigManager(path, { enabled: true }).save();

    expect(readFileSync(path, "utf8")).toBe('{\n  "enabled": true\n}\n');
  });
});
