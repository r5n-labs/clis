import { describe, expect, test } from "bun:test";
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
    expect(() => parseDotenv("BAD-KEY=value")).toThrow("Invalid dotenv key");
  });

  test("parses quoted values before stripping inline comments", () => {
    expect(parseDotenv("TOKEN=\"abc\" # staging\nSINGLE='literal' # local\n")).toEqual({
      SINGLE: "literal",
      TOKEN: "abc",
    });
  });
});

describe("serializeDotenv", () => {
  test("sorts keys and quotes values that need escaping", () => {
    const serialized = serializeDotenv({ B: "simple", A: "hello world", C: 'quote "and" newline\n', EMPTY: "" });

    expect(serialized).toBe('A="hello world"\nB=simple\nC="quote \\"and\\" newline\\n"\nEMPTY=\n');
  });
});
