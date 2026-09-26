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
  'msgid "Value"\nmsgstr "Text"\ntrailing_garbage',
])("invalid gettext is rejected during target extraction: %s", (source) => {
  expect(() => translationTargets("broken.po", source)).toThrow("gettext");
});
