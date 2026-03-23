import { describe, expect, test } from "bun:test";
import { nonEmpty } from "../../src/domain/helpers";
import { type ChangesetContent, ChangesetParser } from "../../src/services/ChangesetParser";

describe("nonEmpty", () => {
  test("returns the array when non-empty", () => {
    expect(nonEmpty(["a"])).toEqual(["a"]);
  });

  test("returns undefined when empty", () => {
    expect(nonEmpty([])).toBeUndefined();
  });

  test("single element array", () => {
    expect(nonEmpty([42])).toEqual([42]);
  });

  test("large array preserves all elements", () => {
    const large = Array.from({ length: 1000 }, (_, i) => i);
    const result = nonEmpty(large);
    expect(result).toHaveLength(1000);
    expect(result?.[999]).toBe(999);
  });
});

describe("ChangesetParser.toStoneData", () => {
  const parser = new ChangesetParser("/fake");

  const makeChangeset = (packages: Record<string, string>, summary: string): ChangesetContent => ({
    filename: "test-changeset.md",
    packages,
    summary,
  });

  test("converts major packages correctly", () => {
    const cs = makeChangeset({ "@app/core": "major", "@app/ui": "major" }, "Breaking change");
    const result = parser.toStoneData(cs);

    expect(result.major).toEqual(["@app/core", "@app/ui"]);
    expect(result.minor).toBeUndefined();
    expect(result.patch).toBeUndefined();
  });

  test("converts minor packages correctly", () => {
    const cs = makeChangeset({ "@app/utils": "minor" }, "New feature");
    const result = parser.toStoneData(cs);

    expect(result.minor).toEqual(["@app/utils"]);
    expect(result.major).toBeUndefined();
    expect(result.patch).toBeUndefined();
  });

  test("converts patch packages correctly", () => {
    const cs = makeChangeset({ "@app/core": "patch", "@app/lib": "patch" }, "Bug fix");
    const result = parser.toStoneData(cs);

    expect(result.patch).toEqual(["@app/core", "@app/lib"]);
    expect(result.major).toBeUndefined();
    expect(result.minor).toBeUndefined();
  });

  test("unknown bump types are silently dropped", () => {
    // BUG: unknown bump types like "prepatch" are silently ignored
    // because the switch statement has no default case
    const cs = makeChangeset({ "@app/core": "prepatch" }, "Pre-release");
    const result = parser.toStoneData(cs);

    expect(result.major).toBeUndefined();
    expect(result.minor).toBeUndefined();
    expect(result.patch).toBeUndefined();
    expect(result.message).toBe("Pre-release");
  });

  test("first line of summary used as message", () => {
    const cs = makeChangeset({ "@app/core": "minor" }, "First line message\nSecond line detail\nThird line");
    const result = parser.toStoneData(cs);

    expect(result.message).toBe("First line message");
    expect(result.description).toBe("Second line detail\nThird line");
  });

  test("fallback message for empty summary", () => {
    const cs = makeChangeset({ "@app/core": "patch" }, "");
    const result = parser.toStoneData(cs);

    expect(result.message).toBe("Migrated from changeset");
    expect(result.description).toBeUndefined();
  });

  test("mixed bump types are categorized correctly", () => {
    const cs = makeChangeset({ "@app/core": "major", "@app/lib": "patch", "@app/utils": "minor" }, "Mixed changes");
    const result = parser.toStoneData(cs);

    expect(result.major).toEqual(["@app/core"]);
    expect(result.minor).toEqual(["@app/utils"]);
    expect(result.patch).toEqual(["@app/lib"]);
  });

  test("description is undefined when summary is single line", () => {
    const cs = makeChangeset({ "@app/core": "patch" }, "Only one line");
    const result = parser.toStoneData(cs);

    expect(result.message).toBe("Only one line");
    expect(result.description).toBeUndefined();
  });
});
