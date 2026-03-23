import { describe, expect, test } from "bun:test";
import { deepMerge } from "../../src/util/misc";

describe("deepMerge", () => {
  test("merges flat objects", () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("source overrides target for same key", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  test("deep nested merge", () => {
    expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
  });

  test("arrays are replaced entirely, not concatenated", () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  test("non-object source returns source", () => {
    expect(deepMerge({ a: 1 }, "string")).toBe("string");
  });

  test("non-object target with object source returns source", () => {
    expect(deepMerge("string", { a: 1 })).toEqual({ a: 1 });
  });

  test("null source returns null (source wins)", () => {
    expect(deepMerge({ a: 1 }, null)).toBeNull();
  });

  test("undefined values in source overwrite target", () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: undefined })).toEqual({ a: undefined, b: 2 });
  });

  test("empty objects merge to empty object", () => {
    expect(deepMerge({}, {})).toEqual({});
  });

  test("deep nested 3+ levels", () => {
    const target = { a: { b: { c: 1, d: 2 }, e: 3 } };
    const source = { a: { b: { c: 10, f: 4 }, g: 5 } };

    expect(deepMerge(target, source)).toEqual({ a: { b: { c: 10, d: 2, f: 4 }, e: 3, g: 5 } });
  });

  /**
   * SECURITY: prototype pollution via constructor key.
   *
   * The current implementation uses spread (`{ ...target }`) and `Object.keys()`,
   * which treats `constructor` as a regular own property on the result object
   * rather than walking up the prototype chain. This means `Object.prototype`
   * is NOT polluted by this particular vector.
   *
   * However, the implementation does NOT explicitly reject dangerous keys
   * (`__proto__`, `constructor`, `prototype`). If the merge strategy changes
   * (e.g., to mutate in place), pollution could be re-introduced. Consider
   * adding an explicit key blocklist for defense in depth.
   */
  test("SECURITY: prototype pollution via constructor key does not pollute Object.prototype", () => {
    const malicious = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');

    const result = deepMerge({}, malicious);

    // Object.prototype must NOT be polluted
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // The constructor key should exist as a plain property on the result
    expect(result).toHaveProperty("constructor");
  });

  test("mixed types: source number overwrites target object", () => {
    expect(deepMerge({ a: { nested: true } }, { a: 42 })).toEqual({ a: 42 });
  });

  test("target keys not in source are preserved", () => {
    expect(deepMerge({ a: 1, b: 2, c: 3 }, { b: 20 })).toEqual({ a: 1, b: 20, c: 3 });
  });
});
