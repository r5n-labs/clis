import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ChangesetContent, ChangesetParser } from "../../src/services/ChangesetParser";

const roots: string[] = [];

function fixture(content: string) {
  const root = mkdtempSync(join(tmpdir(), "sisyphus-changeset-"));
  roots.push(root);
  mkdirSync(join(root, ".changeset"));
  writeFileSync(join(root, ".changeset/change.md"), content);
  return new ChangesetParser(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const changeset = (packages: Record<string, string>, summary: string): ChangesetContent => ({
  filename: "change.md",
  packages,
  summary,
});

describe("ChangesetParser", () => {
  test("preserves every YAML entry and summary horizontal rules", async () => {
    const parser = fixture(`---
"@fixture/double": patch
'@fixture/single': 'minor'
plain: major # breaking change
---
Release all packages

---
More details after the rule.
`);

    const result = await parser.parse();

    expect(result.errors).toEqual([]);
    const changeset = result.changesets[0];
    if (!changeset) throw new Error("Expected a parsed changeset");
    expect(changeset.packages).toEqual({ "@fixture/double": "patch", "@fixture/single": "minor", plain: "major" });
    expect(parser.toStoneData(changeset)).toEqual({
      description: "---\nMore details after the rule.",
      major: ["plain"],
      message: "Release all packages",
      minor: ["@fixture/single"],
      patch: ["@fixture/double"],
    });
  });

  test.each([
    '---\n"pkg": patch\nMissing closing delimiter',
    '---\n"pkg": patch\nbroken: [\n---\nSummary',
    '---\n"pkg": patch\nother: [minor]\n---\nSummary',
  ])("rejects malformed frontmatter without importing a partial package set", async (content) => {
    const result = await fixture(content).parse();
    expect(result.changesets).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  test.each([
    { expected: { message: "Migrated from changeset", patch: ["@fixture/core"] }, summary: "" },
    { expected: { message: "Only one line", patch: ["@fixture/core"] }, summary: "Only one line" },
  ])("uses $expected.message as the message without a description or empty bump lists", ({ expected, summary }) => {
    expect(new ChangesetParser().toStoneData(changeset({ "@fixture/core": "patch" }, summary))).toEqual(expected);
  });

  test.each<{ error: string; packages: Record<string, string> }>([
    {
      error: 'Changeset change.md: @fixture/core uses an unsupported bump type "prepatch"',
      packages: { "@fixture/core": "prepatch" },
    },
    {
      error:
        'Changeset change.md: @fixture/core uses an unsupported bump type "prepatch"; @fixture/ui uses an unsupported bump type "none"',
      packages: { "@fixture/core": "prepatch", "@fixture/ok": "patch", "@fixture/ui": "none" },
    },
  ])("rejects every unsupported bump in one error instead of dropping packages: $error", ({ error, packages }) => {
    expect(() => new ChangesetParser().toStoneData(changeset(packages, "Summary"))).toThrow(error);
  });
});
