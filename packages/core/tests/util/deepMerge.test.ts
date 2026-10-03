import { describe, expect, test } from "bun:test";
import { deepMerge } from "../../src/util/misc";

describe("deepMerge", () => {
  test("merges flat objects", () => {
    expect(deepMerge<{ a: number; b: number }>({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("source overrides target for same key", () => {
    expect(deepMerge<{ a: number }>({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  test("deep nested merge", () => {
    expect(deepMerge<{ a: { b: number; c: number } }>({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
  });

  test.each([
    [{ a: [1, 2] }, { a: [3] }, { a: [3] }],
    [{ a: { retained: true } }, { a: [3] }, { a: [3] }],
    [{ a: [1, 2] }, { a: { named: true } }, { a: { named: true } }],
    [[1, 2], [3], [3]],
  ])("replaces arrays and mismatched container types: %j", (target, source, expected) => {
    expect(deepMerge<unknown>(target, source)).toEqual(expected);
  });

  test("non-object source returns source", () => {
    expect(deepMerge<string>({ a: 1 }, "string")).toBe("string");
  });

  test("non-object target with object source returns source", () => {
    expect(deepMerge<{ a: number }>("string", { a: 1 })).toEqual({ a: 1 });
  });

  test("null source returns null (source wins)", () => {
    expect(deepMerge({ a: 1 }, null)).toBeNull();
  });

  test("undefined values in source overwrite target", () => {
    expect(deepMerge<{ a: undefined; b: number }>({ a: 1, b: 2 }, { a: undefined })).toEqual({ a: undefined, b: 2 });
  });

  test("empty objects merge to empty object", () => {
    expect(deepMerge<Record<string, never>>({}, {})).toEqual({});
  });

  test("deep nested 3+ levels", () => {
    const target = { a: { b: { c: 1, d: 2 }, e: 3 } };
    const source = { a: { b: { c: 10, f: 4 }, g: 5 } };

    const expected = { a: { b: { c: 10, d: 2, f: 4 }, e: 3, g: 5 } };
    expect(deepMerge<typeof expected>(target, source)).toEqual(expected);
  });

  test.each([
    ["__proto__", { polluted: true }],
    ["constructor", { prototype: { polluted: true } }],
    ["toString", { polluted: true }],
  ] as const)("preserves %s as own data without changing prototypes", (key, value) => {
    const source = JSON.parse(JSON.stringify({ [key]: value }));
    const result = deepMerge<Record<string, unknown>>({}, source);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, key)).toBe(true);
    expect(result[key]).toEqual(value);
  });

  test("mixed types: source number overwrites target object", () => {
    expect(deepMerge<{ a: number }>({ a: { nested: true } }, { a: 42 })).toEqual({ a: 42 });
  });

  test("target keys not in source are preserved", () => {
    expect(deepMerge<{ a: number; b: number; c: number }>({ a: 1, b: 2, c: 3 }, { b: 20 })).toEqual({
      a: 1,
      b: 20,
      c: 3,
    });
  });
});
