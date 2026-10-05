import { expect, test } from "bun:test";
import { translationTargets } from "../../src/formats/gettext/parser";

test("gettext library parses adjacent entries while source ranges retain their own comments and text", () => {
  const source = '# First\nmsgctxt "menu"\nmsgid "Start"\nmsgstr "Begin"\n# Second\nmsgid "Stop"\nmsgstr "End"\n';
  const entries = translationTargets("en.po", source);
  expect(entries.map((entry) => [entry.name, entry.line, entry.endLine])).toEqual([
    ["menu:Start", 1, 4],
    [":Stop", 5, 7],
  ]);
  expect(entries[0]?.source).not.toContain("Second");
  expect(entries[1]?.source).toBe('# Second\nmsgid "Stop"\nmsgstr "End"');
});

test("gettext library decodes continuations and quotes, keeps fuzzy evidence and excludes obsolete entries", () => {
  const source = '#~ msgid "Old"\n#~ msgstr "Gone"\n\n#, fuzzy\nmsgid "Say \\""\n"hello\\""\nmsgstr "Greeting"\n';
  const entries = translationTargets("en.po", source);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.translation?.id).toBe('Say "hello"');
  expect(entries[0]?.source).toContain("#, fuzzy");
  expect(entries[0]?.source).not.toContain("Old");
  expect(entries[0]?.line).toBe(4);
});

test.each([
  'msgid "Same"\nmsgstr "One"\nmsgid "Same"\nmsgstr "Two"',
  'msgid "Missing translation"',
  'msgid "Broken quote\nmsgstr "Value"',
  'msgid "Value"\nmsgstr "Unterminated',
  'msgid "Value"\nmsgstr "Unterminated\\',
  'msgid "Value"\nmsgstr "Complete"\n"Unterminated',
  'msgid "Value"\nmsgstr "Text"\ntrailing_garbage',
])("invalid gettext is rejected during target extraction: %s", (source) => {
  expect(() => translationTargets("broken.po", source)).toThrow("gettext");
});

test.each(["constructor", "toString", "__proto__"])(
  "gettext accepts own message ID %s and rejects its duplicate",
  (id) => {
    const entry = `msgid ${JSON.stringify(id)}\nmsgstr "Value"\n`;
    expect(translationTargets("valid.po", entry)[0]?.translation).toEqual({ id, context: "" });
    expect(() => translationTargets("duplicate.po", entry.repeat(2))).toThrow("gettext");
    const contextual = `msgctxt "constructor"\n${entry}`;
    expect(translationTargets("contexts.po", entry + contextual).map((target) => target.translation)).toEqual([
      { id, context: "" },
      { id, context: "constructor" },
    ]);
  },
);

test("gettext keeps contexts, multiline text and plural forms together", () => {
  const entry =
    'msgctxt "combat"\nmsgid "One hit"\nmsgid_plural "%d hits"\nmsgstr[0] "Jedno "\n"uderzenie"\nmsgstr[1] "%d uderzenia"\nmsgstr[2] "%d uderzeń"';
  const entries = translationTargets(
    "pl.po",
    `msgid ""\nmsgstr "Language: pl\\nPlural-Forms: nplurals=3; plural=(n != 1);\\n"\n\n${entry}\n`,
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]?.name).toBe("combat:One hit");
  expect(entries[0]?.translation).toEqual({ context: "combat", id: "One hit" });
  expect(entries[0]?.source).toBe(`Language: pl\nPlural-Forms: nplurals=3; plural=(n != 1);\n\n${entry}`);
});

test.each(["\n", "\r\n"])("gettext preserves source locations across blank separators with %j", (newline) => {
  const lines = [
    'msgid ""',
    'msgstr "Language: pl\\n"',
    "",
    "  ",
    "",
    'msgid "Hello"',
    'msgstr "Cześć"',
    "",
    "",
    "# Greeting",
    'msgid "Bye"',
    'msgstr "Pa"',
    "",
  ];
  const entries = translationTargets("pl.po", lines.join(newline));
  expect(entries.map(({ line, endLine }) => ({ line, endLine }))).toEqual([
    { line: 6, endLine: 7 },
    { line: 10, endLine: 12 },
  ]);
  for (const entry of entries) {
    const block = lines.slice(entry.line - 1, entry.endLine).join("\n");
    expect(entry.source).toEndWith(block);
    expect(entry.source).toStartWith("Language: pl\n");
  }
  expect(() => translationTargets("bad.po", lines.slice(0, 5).concat("broken").join(newline))).toThrow("bad.po:6");
});
