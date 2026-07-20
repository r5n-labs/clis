import { describe, expect, test } from "bun:test";
import { replaceVersion } from "../../src/services/PackageUpdater";

describe("replaceVersion", () => {
  test("preserves surrounding formatting exactly", () => {
    const content = `{
  "bin": { "hydra": "dist/cli.js" },
  "files": ["dist", "LICENSE"],
  "name": "@r5n/hydra",
  "version": "0.8.0"
}
`;

    expect(replaceVersion(content, "0.9.0")).toBe(content.replace('"0.8.0"', '"0.9.0"'));
  });

  test("keeps tabs and compact single-line manifests intact", () => {
    expect(replaceVersion('{"name":"x","version":"1.0.0"}', "1.0.1")).toBe('{"name":"x","version":"1.0.1"}');
    expect(replaceVersion('{\n\t"name": "x",\n\t"version": "1.0.0"\n}\n', "2.0.0")).toBe(
      '{\n\t"name": "x",\n\t"version": "2.0.0"\n}\n',
    );
  });

  test("ignores nested version fields", () => {
    const content = `{
  "engines": {
    "version": "9.9.9"
  },
  "version": "1.0.0"
}
`;
    const updated = replaceVersion(content, "1.0.1");

    expect(updated).toContain('"version": "9.9.9"');
    expect(updated).toContain('"version": "1.0.1"');
  });

  test("ignores a version string inside an array", () => {
    const content = `{
  "keywords": [
    "version"
  ],
  "version": "1.0.0"
}
`;

    expect(replaceVersion(content, "1.2.0")).toBe(content.replace('"1.0.0"', '"1.2.0"'));
  });

  test("ignores a dependency literally named version", () => {
    const content = `{
  "dependencies": { "version": "^1.0.0" },
  "version": "0.1.0"
}
`;
    const updated = replaceVersion(content, "0.2.0");

    expect(updated).toContain('"dependencies": { "version": "^1.0.0" }');
    expect(updated).toContain('"version": "0.2.0"');
  });

  test("handles escaped characters in neighbouring values", () => {
    const content = `{
  "description": "quote \\" and { brace",
  "version": "1.0.0"
}
`;

    expect(replaceVersion(content, "1.0.1")).toBe(content.replace('"1.0.0"', '"1.0.1"'));
  });

  test("falls back to a rewrite when no top-level version exists", () => {
    const updated = replaceVersion('{\n  "name": "x"\n}\n', "1.0.0");

    expect(JSON.parse(updated)).toEqual({ name: "x", version: "1.0.0" });
  });

  test("produces valid JSON for every supported shape", () => {
    const shapes = [
      '{"version":"1.0.0","name":"a"}',
      '{\n  "version": "1.0.0"\n}\n',
      '{\n  "a": { "b": [1, 2] },\n  "version": "1.0.0"\n}\n',
    ];

    for (const shape of shapes) {
      expect(JSON.parse(replaceVersion(shape, "3.4.5")).version).toBe("3.4.5");
    }
  });
});
