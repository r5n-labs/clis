import { describe, expect, test } from "bun:test";

import { toYaml } from "../../src/commands/map";

describe("toYaml", () => {
  describe("primitives", () => {
    test("serializes null", () => {
      expect(toYaml(null)).toBe("null\n");
    });

    test("serializes undefined", () => {
      expect(toYaml(undefined)).toBe("null\n");
    });

    test("serializes true", () => {
      expect(toYaml(true)).toBe("true\n");
    });

    test("serializes false", () => {
      expect(toYaml(false)).toBe("false\n");
    });

    test("serializes integer", () => {
      expect(toYaml(42)).toBe("42\n");
    });

    test("serializes float", () => {
      expect(toYaml(3.14)).toBe("3.14\n");
    });

    test("serializes zero", () => {
      expect(toYaml(0)).toBe("0\n");
    });

    test("serializes plain string", () => {
      expect(toYaml("hello")).toBe("hello\n");
    });

    test("quotes string containing colon", () => {
      expect(toYaml("key: value")).toBe('"key: value"\n');
    });

    test("quotes string containing hash", () => {
      expect(toYaml("has # comment")).toBe('"has # comment"\n');
    });

    test("quotes string containing newline (literal newline in output)", () => {
      // The function wraps in quotes but does not escape the newline character itself
      const result = toYaml("line1\nline2");
      expect(result.startsWith('"')).toBe(true);
      expect(result).toContain("line1");
      expect(result).toContain("line2");
    });

    test("quotes empty string", () => {
      expect(toYaml("")).toBe('""\n');
    });

    test("backslash without special chars outputs unquoted", () => {
      // "path\to" has no colon, hash, or newline, so it is not quoted
      expect(toYaml("path\\to")).toBe("path\\to\n");
    });

    test("double quotes without special chars outputs unquoted", () => {
      // 'say "hi"' has no colon, hash, or newline, so it is not quoted
      expect(toYaml('say "hi"')).toBe('say "hi"\n');
    });

    test("escapes backslash and quotes when string needs quoting", () => {
      // A string with both a colon (triggers quoting) and a backslash
      const result = toYaml("path\\to: somewhere");
      expect(result).toBe('"path\\\\to: somewhere"\n');
    });

    test("escapes double quotes when string needs quoting", () => {
      // A string with both a colon (triggers quoting) and double quotes
      const result = toYaml('key: say "hi"');
      expect(result).toBe('"key: say \\"hi\\""\n');
    });
  });

  describe("arrays", () => {
    test("serializes empty array", () => {
      expect(toYaml([])).toBe("[]\n");
    });

    test("serializes array of primitives", () => {
      const result = toYaml([1, 2, 3]);
      expect(result).toBe("- 1\n- 2\n- 3\n");
    });

    test("serializes array of strings", () => {
      const result = toYaml(["alpha", "beta"]);
      expect(result).toBe("- alpha\n- beta\n");
    });

    test("serializes array of mixed primitives", () => {
      const result = toYaml([1, "two", true, null]);
      expect(result).toBe("- 1\n- two\n- true\n- null\n");
    });

    test("serializes array of objects", () => {
      const result = toYaml([{ name: "a" }, { name: "b" }]);
      expect(result).toBe("- name: a\n- name: b\n");
    });
  });

  describe("objects", () => {
    test("serializes empty object", () => {
      expect(toYaml({})).toBe("{}\n");
    });

    test("serializes flat object", () => {
      const result = toYaml({ name: "atlas", version: 1 });
      expect(result).toBe("name: atlas\nversion: 1\n");
    });

    test("serializes nested object", () => {
      const result = toYaml({ outer: { inner: "value" } });
      expect(result).toBe("outer:\n  inner: value\n");
    });

    test("skips undefined values in objects", () => {
      const result = toYaml({ a: 1, b: undefined, c: 3 });
      expect(result).toBe("a: 1\nc: 3\n");
    });

    test("includes null values in objects", () => {
      const result = toYaml({ a: 1, b: null });
      expect(result).toBe("a: 1\nb: null\n");
    });
  });

  describe("nested structures", () => {
    test("serializes object with array value", () => {
      const result = toYaml({ items: ["a", "b"] });
      expect(result).toBe("items:\n  - a\n  - b\n");
    });

    test("serializes deeply nested structure", () => {
      const result = toYaml({
        level1: {
          level2: {
            value: "deep",
          },
        },
      });
      expect(result).toBe("level1:\n  level2:\n    value: deep\n");
    });

    test("serializes mixed nested structure", () => {
      const result = toYaml({
        name: "project",
        files: ["a.ts", "b.ts"],
        config: { debug: true },
      });
      const expected = [
        "name: project",
        "files:",
        "  - a.ts",
        "  - b.ts",
        "config:",
        "  debug: true",
        "",
      ].join("\n");
      expect(result).toBe(expected);
    });
  });

  describe("indentation", () => {
    test("respects initial indent level", () => {
      expect(toYaml("hello", 2)).toBe("    hello\n");
    });

    test("indents nested object keys correctly", () => {
      const result = toYaml({ a: { b: 1 } }, 1);
      expect(result).toBe("  a:\n    b: 1\n");
    });
  });
});
