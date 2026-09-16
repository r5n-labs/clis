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

  test("arrays are replaced entirely, not concatenated", () => {
    expect(deepMerge<{ a: number[] }>({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
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

  test("prototype pollution via constructor key does not pollute Object.prototype", () => {
    const malicious = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
    const result = deepMerge({}, malicious);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result).toHaveProperty("constructor");
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
