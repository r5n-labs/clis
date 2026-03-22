import { describe, expect, test } from "bun:test";
import type { ArgDefinition } from "../../src/command/args";
import type { PositionalDefinition } from "../../src/command/positionals";
import { buildMriOptions, convertNumbers, mapPositionals, validatePositionals } from "../../src/util/mri-utils";

describe("buildMriOptions", () => {
  test("boolean args go to boolean array", () => {
    const defs: Record<string, ArgDefinition> = {
      verbose: { type: "boolean" },
      debug: { type: "boolean" },
    };
    const opts = buildMriOptions(defs);
    expect(opts.boolean).toEqual(["verbose", "debug"]);
    expect(opts.string).toEqual([]);
  });

  test("string and number args go to string array", () => {
    const defs: Record<string, ArgDefinition> = {
      name: { type: "string" },
      count: { type: "number" },
    };
    const opts = buildMriOptions(defs);
    expect(opts.string).toEqual(["name", "count"]);
    expect(opts.boolean).toEqual([]);
  });

  test("aliases registered correctly", () => {
    const defs: Record<string, ArgDefinition> = {
      verbose: { type: "boolean", alias: "v" },
      output: { type: "string", alias: "o" },
    };
    const opts = buildMriOptions(defs);
    expect(opts.alias.v).toBe("verbose");
    expect(opts.alias.o).toBe("output");
  });

  test("camelCase auto-generates kebab-case alias", () => {
    const defs: Record<string, ArgDefinition> = {
      dryRun: { type: "boolean" },
      outputDir: { type: "string" },
    };
    const opts = buildMriOptions(defs);
    expect(opts.alias["dry-run"]).toBe("dryRun");
    expect(opts.alias["output-dir"]).toBe("outputDir");
  });

  test("defaults populated", () => {
    const defs: Record<string, ArgDefinition> = {
      verbose: { type: "boolean", default: false },
      count: { type: "number", default: 10 },
      name: { type: "string" },
    };
    const opts = buildMriOptions(defs);
    expect(opts.default).toEqual({ verbose: false, count: 10 });
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
    expect(() => convertNumbers({ count: "abc" }, defs)).toThrow(
      'Invalid number for --count: "abc"',
    );
  });

  test("skips boolean and string types", () => {
    const defs: Record<string, ArgDefinition> = {
      verbose: { type: "boolean" },
      name: { type: "string" },
    };
    const result = convertNumbers({ verbose: true, name: "hello" }, defs);
    expect(result.verbose).toBe(true);
    expect(result.name).toBe("hello");
  });

  test("skips undefined values", () => {
    const defs: Record<string, ArgDefinition> = { count: { type: "number" } };
    const result = convertNumbers({} as Record<string, string | boolean>, defs);
    expect(result.count).toBeUndefined();
  });
});

describe("mapPositionals", () => {
  test("maps single positional correctly", () => {
    const defs: Record<string, PositionalDefinition> = {
      name: { required: true },
    };
    const result = mapPositionals(["foo"], defs);
    expect(result.name).toBe("foo");
  });

  test("maps multiple positionals by index", () => {
    const defs: Record<string, PositionalDefinition> = {
      source: { required: true },
      dest: { required: true },
    };
    const result = mapPositionals(["a.txt", "b.txt"], defs);
    expect(result.source).toBe("a.txt");
    expect(result.dest).toBe("b.txt");
  });

  test("variadic positional captures rest as array", () => {
    const defs: Record<string, PositionalDefinition> = {
      first: { required: true },
      rest: { variadic: true },
    };
    const result = mapPositionals(["a", "b", "c", "d"], defs);
    expect(result.first).toBe("a");
    expect(result.rest).toEqual(["b", "c", "d"]);
  });

  test("missing positional returns undefined", () => {
    const defs: Record<string, PositionalDefinition> = {
      name: { required: true },
      extra: {},
    };
    const result = mapPositionals(["foo"], defs);
    expect(result.name).toBe("foo");
    expect(result.extra).toBeUndefined();
  });

  test("extra positionals silently dropped", () => {
    const defs: Record<string, PositionalDefinition> = {
      name: { required: true },
    };
    const result = mapPositionals(["foo", "bar", "baz"], defs);
    expect(result.name).toBe("foo");
    expect(Object.keys(result)).toEqual(["name"]);
  });
});

describe("validatePositionals", () => {
  test("returns null when all required present", () => {
    const defs: Record<string, PositionalDefinition> = {
      name: { required: true },
    };
    const result = validatePositionals({ name: "foo" }, defs);
    expect(result).toBeNull();
  });

  test("returns error for missing required", () => {
    const defs: Record<string, PositionalDefinition> = {
      name: { required: true },
    };
    const result = validatePositionals({ name: undefined }, defs);
    expect(result).toBe("Missing required argument: <name>");
  });

  test("returns error for empty variadic required", () => {
    const defs: Record<string, PositionalDefinition> = {
      files: { required: true, variadic: true },
    };
    const result = validatePositionals({ files: [] }, defs);
    expect(result).toBe("Missing required argument: <files...>");
  });

  test("skips non-required", () => {
    const defs: Record<string, PositionalDefinition> = {
      optional: { required: false },
    };
    const result = validatePositionals({ optional: undefined }, defs);
    expect(result).toBeNull();
  });
});

describe("toKebabCase (via buildMriOptions)", () => {
  test("camelCase generates kebab-case alias", () => {
    const defs: Record<string, ArgDefinition> = {
      myLongOption: { type: "string" },
    };
    const opts = buildMriOptions(defs);
    expect(opts.alias["my-long-option"]).toBe("myLongOption");
  });

  test("already kebab-case does not produce duplicate alias", () => {
    const defs: Record<string, ArgDefinition> = {
      "already-kebab": { type: "string" },
    };
    const opts = buildMriOptions(defs);
    expect(opts.alias["already-kebab"]).toBeUndefined();
  });
});
