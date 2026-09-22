import { expect, test } from "bun:test";
import { translationTargets } from "../../src/formats/gettext/parser";
import { GDScriptAdapter } from "../../src/languages/gdscript/GDScriptAdapter";

test.each([
  ['&"ui.title"', "ui.title"],
  ['"""ui.title"""', "ui.title"],
  ["'''ui.title'''", "ui.title"],
  ['"Hello\\nworld"', "Hello\nworld"],
  ['"ui.\\u0074itle"', "ui.title"],
  ['"\\U01F600"', "😀"],
  ['"\\uD83D\\uDE00"', "😀"],
  ['"\\a\\b\\f\\r\\t\\v"', "\x07\b\f\r\t\v"],
  ['"\\"\\\'\\\\"', "\"'\\"],
  ['"ui.\\\ntitle"', "ui.title"],
  ['"ui.\\\r\ntitle"', "ui.title"],
  ['"""Hello\nworld"""', "Hello\nworld"],
  ['r"ui.\\ntitle"', "ui.\\ntitle"],
  ['r"""ui.\\ntitle"""', "ui.\\ntitle"],
  ['r"quote\\""', 'quote\\"'],
])("decodes GDScript literal %s without changing the evaluated source", async (literal, expected) => {
  const source = `func label():\n    return tr(${literal})\n`;
  const file = await new GDScriptAdapter().parse("example.gd", source);
  const target = file.targets.find((entry) => entry.group === "methods");
  expect(target?.strings).toEqual([expected]);
  expect(target?.source).toBe(source.trimEnd());
});

test.each(['"\\q"', '"\\U110000"'])(
  "rejects unsupported escapes instead of inventing literal evidence: %s",
  async (literal) => {
    await expect(new GDScriptAdapter().parse("example.gd", `func label():\n    return ${literal}\n`)).rejects.toThrow();
  },
);

test("extracts syntax, nested owners, static methods and comments without treating strings or lambdas as methods", async () => {
  const source = `class_name Example
extends Node
var text = "func fake(): pass"
## Computes a value.
static func value(
    input: int,
) -> int:
    var callback = func(): return input
    return callback.call()

class Inner:
    func test_inner() -> void:
        assert(true)
`;
  const file = await new GDScriptAdapter().parse("example.gd", source);
  const methods = file.targets.filter((target) => target.group === "methods");
  expect(methods.map((method) => `${method.owner}.${method.name}`)).toEqual([
    "Example.value",
    "Example.Inner.test_inner",
  ]);
  expect(methods[0]?.comments).toContain("Computes a value");
  expect(methods[0]?.source).toStartWith("static func value(");
  expect(methods[1]?.source).toStartWith("    func test_inner");
  expect(file.targets.filter((target) => target.group === "tests")).toHaveLength(1);
});

test("rejects syntax errors instead of caching a partial parse", async () => {
  await expect(new GDScriptAdapter().parse("broken.gd", "func broken(\n")).rejects.toThrow("syntax not understood");
});

test("constructors are methods, including nested constructors", async () => {
  const file = await new GDScriptAdapter().parse(
    "example.gd",
    "extends Node\nfunc _init():\n    pass\nclass Inner:\n    func _init(value):\n        print(value)\n",
  );
  expect(
    file.targets.filter((target) => target.group === "methods").map((target) => `${target.owner}.${target.name}`),
  ).toEqual(["example._init", "example.Inner._init"]);
  expect(file.targets.find((target) => target.group === "methods")?.declarations).toEqual(["extends Node"]);
});

test("nested classes retain their header without treating outer instance fields as their own", async () => {
  const file = await new GDScriptAdapter().parse(
    "example.gd",
    "class_name Outer\nextends Node\nvar outer_state = 1\nclass Inner extends RefCounted:\n    var inner_state = 2\n    func value():\n        return inner_state\n",
  );
  const inner = file.targets.find((target) => target.group === "classes" && target.owner === "Outer.Inner");
  expect(inner?.source).toStartWith("class Inner extends RefCounted:");
  const method = file.targets.find((target) => target.group === "methods");
  expect(method?.declarations.join("\n")).toContain("extends RefCounted");
  expect(method?.declarations.join("\n")).not.toContain("outer_state");
});

test("gettext keeps contexts, multiline text and plural forms together", () => {
  const entries = translationTargets(
    "pl.po",
    'msgid ""\nmsgstr "Language: pl\\nPlural-Forms: nplurals=3; plural=(n != 1);\\n"\n\nmsgctxt "combat"\nmsgid "One hit"\nmsgid_plural "%d hits"\nmsgstr[0] "Jedno "\n"uderzenie"\nmsgstr[1] "%d uderzenia"\nmsgstr[2] "%d uderzeń"\n',
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]?.name).toBe("combat:One hit");
  expect(entries[0]?.source).toContain("msgstr[1]");
  expect(() => translationTargets("bad.po", 'msgid "Hello"\nbroken')).toThrow("gettext");
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
