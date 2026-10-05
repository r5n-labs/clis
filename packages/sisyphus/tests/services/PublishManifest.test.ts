import { describe, expect, test } from "bun:test";
import { Exit } from "@r5n/cli-core";
import { Package } from "../../src/domain/Package";
import { renderPublishManifest, workspaceVersionsFromPackages } from "../../src/services/PublishManifest";

function renderError(originalText: string): unknown {
  try {
    renderPublishManifest(originalText, { default: {} }, { "@org/internal": { isPrivate: true, version: "0.9.0" } });
  } catch (error) {
    return error;
  }
  throw new Error("Expected renderPublishManifest to throw");
}

describe("PublishManifest", () => {
  test("renderPublishManifest reports manifest failures as Exit with the hint", () => {
    const error = renderError(JSON.stringify({ dependencies: { "@org/internal": "workspace:*" }, name: "@org/app" }));

    if (!(error instanceof Exit)) throw new Error("Expected an Exit error for the private workspace dependency");
    expect(error.message).toBe(
      '"@org/app" depends on private workspace package "@org/internal", which is not published to the registry',
    );
    expect(error.hint).toBe(
      'Move "@org/internal" to devDependencies (bundled CLIs do not need it at runtime) or publish it first',
    );
  });

  test("renderPublishManifest rethrows other failures unchanged", () => {
    const error = renderError("{");

    expect(error).toBeInstanceOf(SyntaxError);
    expect(error).not.toBeInstanceOf(Exit);
  });

  test("workspaceVersionsFromPackages maps names, privacy and empty versions", () => {
    const packages = [
      new Package({ file: "packages/core/package.json", name: "@org/core", version: "1.2.3" }),
      new Package({ file: "packages/internal/package.json", isPrivate: true, name: "@org/internal", version: "0.9.0" }),
      new Package({ file: "packages/x/package.json", name: "@org/x", version: "" }),
    ];

    expect(workspaceVersionsFromPackages(packages)).toEqual({
      "@org/core": { isPrivate: false, version: "1.2.3" },
      "@org/internal": { isPrivate: true, version: "0.9.0" },
      "@org/x": { isPrivate: false, version: null },
    });
  });
});
