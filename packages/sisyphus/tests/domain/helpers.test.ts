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
    const result = parser.toStoneData(makeChangeset({ "@app/core": "major", "@app/ui": "major" }, "Breaking change"));

    expect(result).toMatchObject({ major: ["@app/core", "@app/ui"], minor: undefined, patch: undefined });
  });

  test("converts minor packages correctly", () => {
    const result = parser.toStoneData(makeChangeset({ "@app/utils": "minor" }, "New feature"));

    expect(result).toMatchObject({ major: undefined, minor: ["@app/utils"], patch: undefined });
  });

  test("converts patch packages correctly", () => {
    const result = parser.toStoneData(makeChangeset({ "@app/core": "patch", "@app/lib": "patch" }, "Bug fix"));

    expect(result).toMatchObject({ major: undefined, minor: undefined, patch: ["@app/core", "@app/lib"] });
  });

  test("unknown bump types are rejected instead of dropping the package", () => {
    expect(() => parser.toStoneData(makeChangeset({ "@app/core": "prepatch" }, "Pre-release"))).toThrow(
      'Changeset for @app/core uses an unsupported bump type "prepatch"',
    );
  });

  test("first line of summary used as message", () => {
    const result = parser.toStoneData(
      makeChangeset({ "@app/core": "minor" }, "First line message\nSecond line detail\nThird line"),
    );

    expect(result).toMatchObject({ description: "Second line detail\nThird line", message: "First line message" });
  });

  test("fallback message for empty summary", () => {
    const result = parser.toStoneData(makeChangeset({ "@app/core": "patch" }, ""));

    expect(result).toMatchObject({ description: undefined, message: "Migrated from changeset" });
  });

  test("mixed bump types are categorized correctly", () => {
    const result = parser.toStoneData(
      makeChangeset({ "@app/core": "major", "@app/lib": "patch", "@app/utils": "minor" }, "Mixed changes"),
    );

    expect(result).toMatchObject({ major: ["@app/core"], minor: ["@app/utils"], patch: ["@app/lib"] });
  });

  test("description is undefined when summary is single line", () => {
    const result = parser.toStoneData(makeChangeset({ "@app/core": "patch" }, "Only one line"));

    expect(result).toMatchObject({ description: undefined, message: "Only one line" });
  });
});
