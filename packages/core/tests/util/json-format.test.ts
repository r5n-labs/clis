import { describe, expect, test } from "bun:test";
import { updateJson } from "../../src/util/json-format";

describe("updateJson", () => {
  test.each([
    ['{ "items": [1, 2] }\n', { items: [3, 4] }, '{ "items": [3, 4] }\n'],
    ['{ "items": [1, 2] }\n', { items: [1, 2, 3] }, '{ "items": [1, 2, 3] }\n'],
    ['{ "items": [1, 2] }\n', { items: [2] }, '{ "items": [2] }\n'],
    ['{ "items": [1, 2] }\n', { items: [] }, '{ "items": [] }\n'],
    ['{ "items": [] }\n', { items: ["a"] }, '{ "items": ["a"] }\n'],
    ['{ "items": [] }\n', { items: ["a", "b"] }, '{ "items": ["a", "b"] }\n'],
    ['{ "items": ["a"] }\n', { items: ["a", "b"] }, '{ "items": ["a", "b"] }\n'],
    ['{"items":["a"]}', { items: ["a", "b"] }, '{"items":["a","b"]}'],
    ['{ "nested": {} }', { nested: { items: [1, 2] } }, '{ "nested": { "items": [1, 2] } }'],
    ['{ "nested": { "a": 1, "b": 2 } }', { nested: { b: 3 } }, '{ "nested": { "b": 3 } }'],
    ['{ "nested": { "a": 1, "b": 2 } }', { nested: {} }, '{ "nested": {} }'],
    ['{ "a": 1 }', { a: 1, b: 2 }, '{ "a": 1, "b": 2 }'],
    ['{"a":1}', { a: 1, b: 2 }, '{"a":1,"b":2}'],
    ['{\n\t"a": true\n}\n', { a: true, b: { c: false } }, '{\n\t"a": true,\n\t"b": {\n\t\t"c": false\n\t}\n}\n'],
    ['{\r\n\t"a": true\r\n}\r\n', { b: [1] }, '{\r\n\t"b": [\r\n\t\t1\r\n\t]\r\n}\r\n'],
  ])("retains the layout of %s after structural edits", (content, value, expected) => {
    const updated = updateJson(content, value);

    expect(updated).toBe(expected);
    expect(JSON.parse(updated)).toEqual(value);
  });

  test.each([
    ['{"value":null}', { value: { nested: [true, false] } }],
    ['{"value":{"nested":true}}', { value: [1, null] }],
    ['{"value":[1,2]}', { value: { nested: "after" } }],
    ['{"value":{"nested":true}}', { value: null }],
    ['{"value":{}}', { value: { added: true } }],
    ['{"value":true,"value":false}', { value: true }],
  ])("keeps valid JSON when replacing %s", (content, value) => {
    expect(JSON.parse(updateJson(content, value))).toEqual(value);
  });

  test("rejects invalid source JSON instead of replacing it", () => {
    expect(() => updateJson('{"value": true,}', { value: false })).toThrow();
  });
});
