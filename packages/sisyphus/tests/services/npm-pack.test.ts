import { describe, expect, test } from "bun:test";
import { parseNpmPackOutput } from "../../src/services/release/npm-pack";

const ENTRY = { filename: "probe-pkg-1.0.0.tgz", files: [{ path: "index.js" }], name: "@probe/pkg", version: "1.0.0" };

describe("parseNpmPackOutput", () => {
  test("reads the array document emitted by npm 11", () => {
    expect(parseNpmPackOutput(JSON.stringify([ENTRY]))).toEqual(ENTRY);
  });

  test("reads the package-keyed document emitted by npm 12", () => {
    expect(parseNpmPackOutput(JSON.stringify({ "@probe/pkg": ENTRY }))).toEqual(ENTRY);
  });

  test("returns undefined for empty or scalar documents", () => {
    expect(parseNpmPackOutput("[]")).toBeUndefined();
    expect(parseNpmPackOutput("{}")).toBeUndefined();
    expect(parseNpmPackOutput('"probe"')).toBeUndefined();
    expect(parseNpmPackOutput("[[1]]")).toBeUndefined();
    expect(parseNpmPackOutput("null")).toBeUndefined();
  });

  test("rejects documents that are not JSON", () => {
    expect(() => parseNpmPackOutput("npm warn something")).toThrow();
  });
});
