import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDotenv, serializeDotenv } from "./dotenv";

describe("parseDotenv", () => {
  test("parses comments, export prefixes, quoted values, empty values, and inline comments", () => {
    const parsed = parseDotenv(`
# ignored
export APP=web
MODE=development # inline comment
EMPTY=
QUOTED="hello world"
SINGLE='literal # value'
PLAIN=ok
`);

    expect(parsed).toEqual({
      APP: "web",
      EMPTY: "",
      MODE: "development",
      PLAIN: "ok",
      QUOTED: "hello world",
      SINGLE: "literal # value",
    });
  });

  test("throws on invalid keys", () => {
    expect(() => parseDotenv("BAD-KEY=value")).toThrow("Invalid dotenv key at line 1");
  });

  test("parses prototype-sensitive keys as own properties", () => {
    const parsed = parseDotenv("__proto__=value");

    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toBe("value");
  });

  test("parses quoted values before stripping inline comments", () => {
    expect(parseDotenv("TOKEN=\"abc\" # staging\nSINGLE='literal' # local\n")).toEqual({
      SINGLE: "literal",
      TOKEN: "abc",
    });
  });

  test("reports malformed lines without echoing secret-bearing input", () => {
    const secretBearingLine = "sensitive-value-without-equals";
    const message = getErrorMessage(() => parseDotenv(`# heading\n${secretBearingLine}\n`));

    expect(message).toBe("Invalid dotenv syntax at line 2: expected KEY=VALUE");
    expect(message).not.toContain(secretBearingLine);
  });

  test("decodes double-quoted escapes in one pass", () => {
    const parsed = parseDotenv(String.raw`ESCAPED="line\nreturn\rtab\tquote\"slash\\end"
LITERAL="literal\\n\\r\\t"
BACKSLASH_QUOTE="literal\\\"quote"
`);

    expect(parsed).toEqual({
      BACKSLASH_QUOTE: 'literal\\"quote',
      ESCAPED: 'line\nreturn\rtab\tquote"slash\\end',
      LITERAL: String.raw`literal\n\r\t`,
    });
  });

  test("preserves hashes without preceding whitespace in the bounded grammar", () => {
    expect(parseDotenv("TOKEN=abc#fragment\n")).toEqual({ TOKEN: "abc#fragment" });
  });
});

describe("serializeDotenv", () => {
  test("sorts keys and uses representable quoted forms", () => {
    const serialized = serializeDotenv({
      B: "simple",
      A: " leading and trailing ",
      C: "#hash",
      D: "it's # literal",
      EMPTY: "",
    });

    expect(serialized).toBe("A=' leading and trailing '\nB=simple\nC='#hash'\nD=\"it's # literal\"\nEMPTY=\n");
  });

  test("round-trips supported values through the Atlas parser and Bun env loader", () => {
    const env = {
      ATLAS_BOTH_QUOTES: `both ' and " quotes`,
      ATLAS_CARRIAGE: "left\rright",
      ATLAS_DOLLAR: String.raw`price $5 and \$HOME`,
      ATLAS_DOUBLE_QUOTE: 'say "hello"',
      ATLAS_EMPTY: "",
      ATLAS_HASH: "token#fragment",
      ATLAS_LITERAL_ESCAPES: String.raw`literal\n\r\t\\end`,
      ATLAS_NEWLINE: "line one\nit's line two",
      ATLAS_PLAIN: "simple",
      ATLAS_SINGLE_QUOTE: "it's # literal",
      ATLAS_SPACES: "  spaced value  ",
    };

    const serialized = serializeDotenv(env);

    expect(parseDotenv(serialized)).toEqual(env);
    expect(loadWithBun(serialized, Object.keys(env))).toEqual(env);
  });

  test("round-trips dollar positions in unquoted, single-quoted, and double-quoted output", () => {
    const env = {
      ATLAS_DOUBLE_DOLLAR_END: "'trailing$",
      ATLAS_DOUBLE_DOLLAR_MIDDLE: "middle$value'#",
      ATLAS_DOUBLE_DOLLAR_START: "$leading'#",
      ATLAS_SINGLE_DOLLAR_END: " trailing$",
      ATLAS_SINGLE_DOLLAR_MIDDLE: "middle$value #",
      ATLAS_SINGLE_DOLLAR_START: "$leading ",
      ATLAS_UNQUOTED_DOLLAR_END: "trailing$",
      ATLAS_UNQUOTED_DOLLAR_MIDDLE: "middle$value",
      ATLAS_UNQUOTED_DOLLAR_ONLY: "$",
      ATLAS_UNQUOTED_DOLLAR_START: "$leading",
    };

    const serialized = serializeDotenv(env);

    expect(serialized).toContain("ATLAS_UNQUOTED_DOLLAR_ONLY=$\n");
    expect(serialized).toContain("ATLAS_UNQUOTED_DOLLAR_END=trailing$\n");
    expect(serialized).toContain("ATLAS_UNQUOTED_DOLLAR_START=\\$leading\n");
    expect(serialized).toContain("ATLAS_SINGLE_DOLLAR_END=' trailing$'\n");
    expect(serialized).toContain("ATLAS_SINGLE_DOLLAR_START='\\$leading '\n");
    expect(serialized).toContain('ATLAS_DOUBLE_DOLLAR_END="\'trailing$"\n');
    expect(serialized).toContain('ATLAS_DOUBLE_DOLLAR_START="\\$leading\'#"\n');
    expect(parseDotenv(serialized)).toEqual(env);
    expect(loadWithBun(serialized, Object.keys(env))).toEqual(env);
  });

  test("round-trips a multi-key corpus with safe trailing backslash parity", () => {
    const env = {
      ATLAS_AFTER_BACKSLASHES: "after",
      ATLAS_BEFORE_BACKSLASHES: "before",
      ATLAS_FOUR_BACKSLASHES: " leading\\\\\\\\",
      ATLAS_TWO_BACKSLASHES: " leading\\\\",
    };

    const serialized = serializeDotenv(env);

    expect(parseDotenv(serialized)).toEqual(env);
    expect(loadWithBun(serialized, Object.keys(env))).toEqual(env);
  });

  test("rejects invalid keys without exposing keys or values", () => {
    const secretValue = "sensitive-value";

    for (const key of ["BAD-KEY", "BAD=KEY", "BAD\nINJECTED", "1BAD"]) {
      const message = getErrorMessage(() => serializeDotenv({ [key]: secretValue }));

      expect(message).toBe("Invalid dotenv key at entry 1");
      expect(message).not.toContain(key);
      expect(message).not.toContain(secretValue);
    }
  });

  test("rejects NUL and values outside the minimal representable grammar", () => {
    const nulValue = "sensitive\0value";
    const mixedQuoteValue = `"sensitive' # value`;

    for (const value of [nulValue, mixedQuoteValue]) {
      const message = getErrorMessage(() => serializeDotenv({ SECRET: value }));

      expect(message).toBe("Unrepresentable dotenv value at entry 1");
      expect(message).not.toContain(value);
    }
  });

  test("rejects single-quoted forms ending in odd backslash counts", () => {
    const values = [" leading\\", " leading\\\\\\", "#hash\\"];

    for (const value of values) {
      const message = getErrorMessage(() => serializeDotenv({ AFTER: "safe", SECRET: value }));

      expect(message).toBe("Unrepresentable dotenv value at entry 2");
      expect(message).not.toContain(value);
    }
  });

  test("rejects dollar forms without a common Atlas and Bun round-trip representation", () => {
    const values = [String.raw`\$`, String.raw`a\$`, String.raw` trailing\$`];

    for (const value of values) {
      const message = getErrorMessage(() => serializeDotenv({ SECRET: value }));

      expect(message).toBe("Unrepresentable dotenv value at entry 1");
      expect(message).not.toContain(value);
    }
  });
});

function getErrorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected operation to throw");
}

function loadWithBun(input: string, keys: string[]): Record<string, string> {
  const directory = mkdtempSync(join(tmpdir(), "atlas-dotenv-round-trip-"));
  const path = join(directory, ".env");

  try {
    writeFileSync(path, input, "utf8");
    const expression = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(
      keys,
    )}.map((key) => [key, process.env[key]]))))`;
    const result = Bun.spawnSync({
      cmd: [process.execPath, `--env-file=${path}`, "--eval", expression],
      env: {},
      stderr: "pipe",
      stdout: "pipe",
    });

    if (result.exitCode !== 0) {
      throw new Error(`Bun env-file loader exited with code ${result.exitCode}`);
    }

    return JSON.parse(result.stdout.toString()) as Record<string, string>;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
