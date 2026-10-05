import { describe, expect, test } from "bun:test";
import { deepMerge } from "../../src/util/misc";

describe("deepMerge", () => {
  test.each([
    [
      "merges nested records, overriding shared keys and preserving the rest",
      { a: { b: { c: 1, d: 2 }, e: 3 } },
      { a: { b: { c: 10, f: 4 }, g: 5 } },
      { a: { b: { c: 10, d: 2, f: 4 }, e: 3, g: 5 } },
    ],
    ["overwrites target values with undefined", { a: 1, b: 2 }, { a: undefined }, { a: undefined, b: 2 }],
    ["replaces arrays", { a: [1, 2] }, { a: [3] }, { a: [3] }],
    ["replaces a record with an array", { a: { retained: true } }, { a: [3] }, { a: [3] }],
    ["replaces an array with a record", { a: [1, 2] }, { a: { named: true } }, { a: { named: true } }],
    ["replaces a top-level array", [1, 2], [3], [3]],
    ["replaces a record with a non-record source", { a: { nested: true } }, { a: null }, { a: null }],
    ["returns the source when the target is not a record", "string", { a: 1 }, { a: 1 }],
  ])("%s", (_name, target, source, expected) => {
    expect(deepMerge<unknown>(target, source)).toEqual(expected);
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
});
