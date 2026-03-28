import { describe, expect, test } from "bun:test";
import type { ArgDefinition } from "../../src/command/args";
import type { PositionalDefinition } from "../../src/command/positionals";
import { buildMriOptions, convertNumbers, mapPositionals, validatePositionals } from "../../src/util/mri-utils";

describe("buildMriOptions", () => {
  test("boolean args go to boolean array", () => {
    const defs: Record<string, ArgDefinition> = { debug: { type: "boolean" }, verbose: { type: "boolean" } };

    expect(buildMriOptions(defs)).toMatchObject({ boolean: ["debug", "verbose"], string: [] });
  });

  test("string and number args go to string array", () => {
    const defs: Record<string, ArgDefinition> = { count: { type: "number" }, name: { type: "string" } };

    expect(buildMriOptions(defs)).toMatchObject({ boolean: [], string: ["count", "name"] });
  });

  test("aliases registered correctly", () => {
    const defs: Record<string, ArgDefinition> = {
      output: { alias: "o", type: "string" },
      verbose: { alias: "v", type: "boolean" },
    };

    expect(buildMriOptions(defs).alias).toMatchObject({ o: "output", v: "verbose" });
  });

  test("camelCase auto-generates kebab-case alias", () => {
    const defs: Record<string, ArgDefinition> = { dryRun: { type: "boolean" }, outputDir: { type: "string" } };

    expect(buildMriOptions(defs).alias).toMatchObject({ "dry-run": "dryRun", "output-dir": "outputDir" });
  });

  test("defaults populated", () => {
    const defs: Record<string, ArgDefinition> = {
      count: { default: 10, type: "number" },
      name: { type: "string" },
      verbose: { default: false, type: "boolean" },
    };
    const opts = buildMriOptions(defs);
    expect(opts.default).toEqual({ count: 10, verbose: false });
  });
});

describe("convertNumbers", () => {
  test("converts string '42' to number 42", () => {
    const defs: Record<string, ArgDefinition> = { count: { type: "number" } };
    const result = convertNumbers({ count: "42" }, defs);
    expect(result.count).toBe(42);
  });

  test("throws on invalid number (NaN)", () => {
    const defs: Record<string, ArgDefinition> = { count: { type: "number" } };
    expect(() => convertNumbers({ count: "abc" }, defs)).toThrow('Invalid number for --count: "abc"');
  });

  test("skips boolean and string types", () => {
    const defs: Record<string, ArgDefinition> = { name: { type: "string" }, verbose: { type: "boolean" } };

    expect(convertNumbers({ name: "hello", verbose: true }, defs)).toMatchObject({ name: "hello", verbose: true });
  });

  test("skips undefined values", () => {
    const defs: Record<string, ArgDefinition> = { count: { type: "number" } };
    const result = convertNumbers({} as Record<string, string | boolean>, defs);
    expect(result.count).toBeUndefined();
  });
});

describe("mapPositionals", () => {
  test("maps single positional correctly", () => {
    const defs: Record<string, PositionalDefinition> = { name: { required: true } };
    const result = mapPositionals(["foo"], defs);
    expect(result.name).toBe("foo");
  });

  test("maps multiple positionals by index", () => {
    const defs: Record<string, PositionalDefinition> = { dest: { required: true }, source: { required: true } };

    expect(mapPositionals(["a.txt", "b.txt"], defs)).toMatchObject({ dest: "a.txt", source: "b.txt" });
  });

  test("variadic positional captures rest as array", () => {
    const defs: Record<string, PositionalDefinition> = { first: { required: true }, rest: { variadic: true } };

    expect(mapPositionals(["a", "b", "c", "d"], defs)).toMatchObject({ first: "a", rest: ["b", "c", "d"] });
  });

  test("missing positional returns undefined", () => {
    const defs: Record<string, PositionalDefinition> = { extra: {}, name: { required: true } };

    expect(mapPositionals(["foo"], defs)).toMatchObject({ extra: "foo", name: undefined });
  });

  test("extra positionals silently dropped", () => {
    const defs: Record<string, PositionalDefinition> = { name: { required: true } };
    const result = mapPositionals(["foo", "bar", "baz"], defs);

    expect(result).toEqual({ name: "foo" });
  });
});

describe("validatePositionals", () => {
  test("returns null when all required present", () => {
    const defs: Record<string, PositionalDefinition> = { name: { required: true } };
    const result = validatePositionals({ name: "foo" }, defs);
    expect(result).toBeNull();
  });

  test("returns error for missing required", () => {
    const defs: Record<string, PositionalDefinition> = { name: { required: true } };
    const result = validatePositionals({ name: undefined }, defs);
    expect(result).toBe("Missing required argument: <name>");
  });

  test("returns error for empty variadic required", () => {
    const defs: Record<string, PositionalDefinition> = { files: { required: true, variadic: true } };
    const result = validatePositionals({ files: [] }, defs);
    expect(result).toBe("Missing required argument: <files...>");
  });

  test("skips non-required", () => {
    const defs: Record<string, PositionalDefinition> = { optional: { required: false } };
    const result = validatePositionals({ optional: undefined }, defs);
    expect(result).toBeNull();
  });
});

describe("toKebabCase (via buildMriOptions)", () => {
  test("camelCase generates kebab-case alias", () => {
    const defs: Record<string, ArgDefinition> = { myLongOption: { type: "string" } };
    const opts = buildMriOptions(defs);
    expect(opts.alias["my-long-option"]).toBe("myLongOption");
  });

  test("already kebab-case does not produce duplicate alias", () => {
    const defs: Record<string, ArgDefinition> = { "already-kebab": { type: "string" } };
    const opts = buildMriOptions(defs);
    expect(opts.alias["already-kebab"]).toBeUndefined();
  });
});
