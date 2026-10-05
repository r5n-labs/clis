import { describe, expect, test } from "bun:test";
import { nonEmpty } from "../../src/domain/helpers";

describe("nonEmpty", () => {
  test("returns the array when non-empty", () => {
    expect(nonEmpty(["a"])).toEqual(["a"]);
  });

  test("returns undefined when empty", () => {
    expect(nonEmpty([])).toBeUndefined();
  });
});
