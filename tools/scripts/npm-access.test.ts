import { describe, expect, test } from "bun:test";
import { resolveNpmAccess } from "./npm-access";

describe("resolveNpmAccess", () => {
  test.each([{}, { publishConfig: {} }, { publishConfig: { registry: "https://registry.example.test" } }])(
    "defaults to public only when access is omitted from valid configuration: %p",
    (manifest) => {
      expect(resolveNpmAccess(JSON.stringify(manifest))).toBe("public");
    },
  );

  test.each(["public", "restricted"])("preserves explicit %s access", (access) => {
    expect(resolveNpmAccess(JSON.stringify({ publishConfig: { access } }))).toBe(access);
  });

  test.each([
    { manifest: [] },
    { manifest: null },
    { manifest: false },
    { manifest: { publishConfig: [] } },
    { manifest: { publishConfig: null } },
    { manifest: { publishConfig: "restricted" } },
    { manifest: { publishConfig: { access: "restriced" } } },
    { manifest: { publishConfig: { access: "" } } },
    { manifest: { publishConfig: { access: null } } },
    { manifest: { publishConfig: { access: ["restricted"] } } },
  ])("rejects invalid permission configuration: %p", ({ manifest }) => {
    expect(() => resolveNpmAccess(JSON.stringify(manifest))).toThrow("Invalid publishConfig.access");
  });
});
