import { describe, expect, test } from "bun:test";
import type { ArgDefinition } from "../../src/command/args";
import type { PositionalDefinition } from "../../src/command/positionals";
import { Exit } from "../../src/exit";
import { mapPositionals, parseCommandArgs, parseGlobalArgs, validatePositionals } from "../../src/util/mri-utils";

describe("parseCommandArgs", () => {
  test.each([
    { argv: [], expected: { count: 10, dryRun: false } },
    {
      argv: ["-o", "build", "-d", "-c", "42", "--already-kebab", "plain"],
      expected: { count: 42, dryRun: true, outputDir: "build", "already-kebab": "plain" },
    },
    { argv: ["--output-dir=build", "--dry-run"], expected: { count: 10, dryRun: true, outputDir: "build" } },
    { argv: ["--outputDir=build", "--dryRun=false"], expected: { count: 10, dryRun: false, outputDir: "build" } },
  ])("parses typed values, aliases and defaults: %j", ({ argv, expected }) => {
    const definitions: Record<string, ArgDefinition> = {
      "already-kebab": { type: "string" },
      count: { alias: "c", default: 10, type: "number" },
      dryRun: { alias: "d", default: false, type: "boolean" },
      outputDir: { alias: "o", type: "string" },
    };
    expect(parseCommandArgs([...argv], definitions).args).toMatchObject(expected);
  });

  test("leaves an unprovided numeric option without a default absent", () => {
    expect(parseCommandArgs([], { count: { type: "number" } }).args.count).toBeUndefined();
  });
});

describe("declared no-* boolean aliases", () => {
  const defs: Record<string, ArgDefinition> = {
    noCommit: { default: false, type: "boolean" },
    npm: { default: true, type: "boolean" },
  };

  test("sets a declared noCommit option through its advertised --no-commit alias", () => {
    const result = parseCommandArgs(["--no-commit"], defs);
    expect(result.args.noCommit).toBe(true);
    expect(result.args.commit).toBeUndefined();
  });

  test("still negates ordinary boolean options", () => {
    expect(parseCommandArgs(["--no-npm"], defs).args.npm).toBe(false);
  });

  test("keeps no-* child options unchanged after the delimiter", () => {
    const result = parseCommandArgs(["--", "--no-commit"], defs);
    expect(result.args.noCommit).toBe(false);
    expect(result.rawPositionals).toEqual(["--no-commit"]);
  });
});

describe("argument validation", () => {
  test.each([
    { argv: ["--no-npm", "--no-npm"] },
    { argv: ["--npm", "--no-npm"] },
    { argv: ["--no-npm", "--npm"] },
    { argv: ["--npm", "-n"] },
    { argv: ["-n", "--npm"] },
    { argv: ["-n", "--no-npm"] },
    { argv: ["--no-n", "--npm=false"] },
    { argv: ["-nn"] },
  ])("rejects repeated positive, negative and aliased options: %j", ({ argv }) => {
    const defs: Record<string, ArgDefinition> = { npm: { alias: "n", default: true, type: "boolean" } };
    expect(() => parseCommandArgs([...argv], defs)).toThrow("--npm can only be provided once");
  });

  test("rejects a repeated camelCase option across its automatic alias", () => {
    const defs: Record<string, ArgDefinition> = { dryRun: { default: false, type: "boolean" } };
    expect(() => parseCommandArgs(["--dry-run", "--dryRun"], defs)).toThrow("--dry-run can only be provided once");
  });

  test("keeps inline values, defaults and child flags outside occurrence validation", () => {
    const defs: Record<string, ArgDefinition> = {
      npm: { alias: "n", default: true, type: "boolean" },
      output: { type: "string" },
    };
    const parsed = parseCommandArgs(["--output=--npm", "--npm=false", "--", "--npm", "-n"], defs);
    expect(parsed.args).toMatchObject({ npm: false, output: "--npm" });
    expect(parsed.rawPositionals).toEqual(["--npm", "-n"]);
  });

  test.each([
    { argv: ["--retention-days"] },
    { argv: ["--retention-days="] },
    { argv: ["--retention-days", "   "] },
    { argv: ["--retention-days", "Infinity"] },
    { argv: ["--retention-days=-Infinity"] },
    { argv: ["--retention-days", "1e999"] },
    { argv: ["--retention-days", "abc"] },
    { argv: ["--no-retention-days"] },
    { argv: ["--retention-days", "-1"] },
    { argv: ["-d"] },
  ])("rejects malformed numeric flags without falling back to zero: %j", ({ argv }) => {
    const defs: Record<string, ArgDefinition> = { retentionDays: { alias: "d", default: 30, type: "number" } };
    expect(() => parseCommandArgs([...argv], defs)).toThrow(Exit);
    expect(() => parseCommandArgs([...argv], defs)).toThrow("Invalid number for --retention-days");
  });

  test.each([
    { argv: [], expected: 30 },
    { argv: ["--retention-days=0"], expected: 0 },
    { argv: ["--retention-days=-1"], expected: -1 },
    { argv: ["-d", "2.5"], expected: 2.5 },
  ])("preserves finite numeric values and defaults: %j", ({ argv, expected }) => {
    const defs: Record<string, ArgDefinition> = { retentionDays: { alias: "d", default: 30, type: "number" } };
    expect(parseCommandArgs([...argv], defs).args.retentionDays).toBe(expected);
  });

  test("throws Exit when a long flag is repeated", () => {
    const defs: Record<string, ArgDefinition> = { json: { alias: "j", type: "boolean" } };

    expect(() => parseCommandArgs(["--json", "--json"], defs)).toThrow(Exit);
    expect(() => parseCommandArgs(["--json", "--json"], defs)).toThrow("--json can only be provided once");
  });

  test("repeated short alias reports the canonical long flag", () => {
    const defs: Record<string, ArgDefinition> = { json: { alias: "j", type: "boolean" } };

    expect(() => parseCommandArgs(["-j", "-j"], defs)).toThrow("--json can only be provided once");
  });

  test("repeated camelCase flag reports the kebab-case name", () => {
    const defs: Record<string, ArgDefinition> = { dryRun: { alias: "d", type: "boolean" } };

    expect(() => parseCommandArgs(["-d", "-d"], defs)).toThrow("--dry-run can only be provided once");
  });

  test("rejects repeated string aliases using the canonical diagnostic", () => {
    const defs: Record<string, ArgDefinition> = { output: { alias: "o", type: "string" } };
    expect(() => parseCommandArgs(["-o", "a", "--output", "b"], defs)).toThrow("--output can only be provided once");
  });

  test("undefined short flag keeps a single dash", () => {
    const defs: Record<string, ArgDefinition> = { json: { alias: "j", type: "boolean" } };

    expect(() => parseCommandArgs(["-x", "-x"], defs)).toThrow("-x can only be provided once");
  });
});

describe("parseGlobalArgs", () => {
  const globals: Record<string, ArgDefinition> = { help: { alias: "h", type: "boolean" } };

  test("repeated global flag reports the canonical long flag", () => {
    expect(() => parseGlobalArgs(["-h", "-h"], globals)).toThrow("--help can only be provided once");
  });

  test.each([
    { argv: ["--help", "-h"] },
    { argv: ["-h", "--no-help"] },
    { argv: ["--no-help", "--no-help"] },
    { argv: ["-hh"] },
  ])("rejects repeated global spellings: %j", ({ argv }) => {
    expect(() => parseGlobalArgs([...argv], globals)).toThrow("--help can only be provided once");
  });

  test("repeated command flags are left to the command parse", () => {
    const result = parseGlobalArgs(["check", "-j", "-j"], globals);

    expect(result).toMatchObject({ command: "check", restArgs: ["-j", "-j"] });
  });

  test.each([{ argv: ["--dry-run", "cleanup"] }, { argv: ["--profile", "app", "run", "child"] }])(
    "rejects command options placed before the command: %j",
    ({ argv }) => {
      expect(() => parseGlobalArgs([...argv], globals)).toThrow(Exit);
      expect(() => parseGlobalArgs([...argv], globals)).toThrow("Unknown option:");
    },
  );

  test("keeps recognised globals before the command and leaves command flags intact", () => {
    expect(parseGlobalArgs(["-h", "check", "--json"], globals)).toMatchObject({
      command: "check",
      flags: { h: true, help: true },
      restArgs: ["--json"],
    });
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
