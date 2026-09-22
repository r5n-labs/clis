import { expect, test } from "bun:test";
import { createAnalysis } from "../../src/composition/analysis";
import { parseConfig, parseQuestion } from "../../src/config/validation";
import { ContextBuilder } from "../../src/contexts/ContextBuilder";
import { presetQuestions } from "../../src/presets";
import previousComments from "../../src/presets/comments-v1.json";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { fixture } from "../helpers";

const local = parseQuestion({
  id: "contract",
  type: "choice",
  context: "class",
  instructions: "Check the local contract",
  criteria: { matches: "Matches", insufficient_context: "Unknown" },
});
async function review(
  files: Record<string, string>,
  options: { name?: string; group?: string; expanded?: boolean; references?: boolean } = {},
) {
  const f = fixture("all");
  for (const [path, source] of Object.entries(files)) f.write(path, source);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const target = project.targets.find(
    (t) =>
      t.path === "target.gd" && t.group === (options.group ?? "methods") && (!options.name || t.name === options.name),
  );
  if (!target) throw new Error("Missing target");
  return new ContextBuilder(project).build(
    target,
    { ...local, context: options.references ? "references" : "class" },
    options.expanded,
  );
}

test("local naming includes class intent and the overridden base contract without unrelated external bodies", async () => {
  const context = await review(
    {
      "target.gd":
        "class_name FreePayment\nextends Payment\n## Development policy: keep costs visible without spending.\nfunc try_pay(cost: int):\n    return cost > 0\nfunc unused():\n    return Other.value()\n",
      "payment.gd":
        "class_name Payment\n## Payment interface.\nfunc try_pay(cost: int):\n    return spend(cost)\nfunc spend(cost: int):\n    return cost > 0\n",
      "other.gd": "class_name Other\nstatic func value():\n    return 999\n",
    },
    { name: "try_pay" },
  );
  expect(context.source).toContain("Development policy");
  expect(context.source).not.toContain("func unused");
  expect(context.related.find((e) => e.path === "payment.gd")?.source).toContain("Payment interface");
  expect(context.related.find((e) => e.path === "payment.gd")?.source).toContain("func try_pay");
  expect(context.related.find((e) => e.path === "other.gd")).toBeUndefined();
});

test("self-qualified local calls work and external implementations wait for expansion", async () => {
  const files = {
    "target.gd": "func value():\n    return self.helper()\nfunc helper():\n    return Other.value()\n",
    "other.gd": "class_name Other\nstatic func value():\n    return 3\n",
  };
  const initial = await review(files, { name: "value" });
  expect(initial.source).toContain("func helper");
  expect(initial.related).toHaveLength(0);
  expect((await review(files, { name: "value", expanded: true })).related[0]?.source).toContain("return 3");
});

test("expanded usage includes argument preparation and result use, not same-name methods of unrelated types", async () => {
  const context = await review(
    {
      "target.gd": "class_name Account\nfunc pay(cost: int):\n    return cost > 0\n",
      "caller.gd":
        "func purchase(account: Account, price: int):\n    var cost = maxi(price, 1)\n    if account.pay(cost):\n        finish()\n",
      "unrelated.gd": "class_name Other\nfunc pay(value):\n    return value\nfunc usage():\n    pay(10)\n",
    },
    { name: "pay", expanded: true },
  );
  const usage = context.related.find((e) => e.path === "caller.gd")?.source;
  expect(usage).toContain("maxi(price, 1)");
  expect(usage).toContain("finish()");
  expect(context.related.find((e) => e.path === "unrelated.gd")).toBeUndefined();
  expect(context.notes?.join()).toContain("1 of 1");
});

test("test context includes fixtures and resolves autoload calls without reading excluded scripts", async () => {
  const context = await review(
    {
      "project.godot": '[autoload]\nLedger="*res://ledger.gd"\nSecret="*res://addons/secret.gd"\n',
      "target.gd":
        "var balance = 0\nfunc setup():\n    balance = 5\nfunc teardown():\n    balance = 0\nfunc test_pay():\n    Ledger.pay(balance)\n    Secret.hidden()\n",
      "ledger.gd": "func pay(amount):\n    return amount > 0\n",
      "addons/secret.gd": "func hidden():\n    return 123\n",
    },
    { name: "test_pay", group: "tests", references: true },
  );
  expect(context.source).toContain("func setup");
  expect(context.source).toContain("func teardown");
  expect(context.related.find((e) => e.path === "ledger.gd")?.source).toContain("func pay");
  expect(context.related.find((e) => e.path === "addons/secret.gd")).toBeUndefined();
  expect(context.unresolved?.flatMap((e) => e.expressions)).toContain("Secret.hidden()");
});

test("scene instances resolve attached scripts and supplied wiring retains signal connections", async () => {
  const context = await review(
    {
      "target.gd":
        'func test_scene():\n    var scene = preload("res://counter.tscn").instantiate()\n    assert(scene.value() == 1)\n',
      "counter.tscn":
        '[gd_scene format=3]\n[ext_resource type="Script" path="res://counter.gd" id="1"]\n[node name="Counter" type="Node"]\nscript = ExtResource("1")\n[connection signal="ready" from="." to="." method="begin"]\n',
      "counter.gd": "func value():\n    return 1\nfunc unused():\n    return 99\n",
    },
    { group: "tests", references: true },
  );
  expect(context.related.find((e) => e.path === "counter.gd")?.source).toContain("func value");
  expect(context.related.find((e) => e.path === "counter.gd")?.source).not.toContain("func unused");
  expect(context.related.find((e) => e.path === "counter.tscn")?.source).toContain('signal="ready"');
});

test("translation context supplies selected resource records, owning description and parallel catalogue", async () => {
  const f = fixture("all");
  f.write(
    "ui.en.po",
    'msgid "effect.name"\nmsgstr "Guarded"\n\nmsgid "upgrade.description"\nmsgstr "Grants protection."\n',
  );
  f.write(
    "ui.pl.po",
    'msgid "effect.name"\nmsgstr "Osłona"\n\nmsgid "upgrade.description"\nmsgstr "Zapewnia ochronę."\n',
  );
  f.write(
    "effects.tres",
    '[gd_resource format=3]\n[sub_resource type="Resource" id="effect"]\ndisplay_name = "effect.name"\n[sub_resource type="Resource" id="upgrade"]\ndescription = "upgrade.description"\neffect = SubResource("effect")\n[sub_resource type="Resource" id="unrelated"]\ntext = "omit me"\n',
  );
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const target = project.targets.find((t) => t.path === "ui.pl.po" && t.translation?.id === "effect.name");
  const question = presetQuestions(["translations"])[0]?.question;
  if (!target || !question) throw new Error("missing fixture");
  const context = new ContextBuilder(project).build(target, question);
  expect(context.related.find((e) => e.path === "ui.en.po")?.source).toContain("Guarded");
  expect(context.related.find((e) => e.path === "effects.tres")?.source).toContain("upgrade.description");
  expect(context.related.find((e) => e.path === "effects.tres")?.source).not.toContain("omit me");
  expect(context.related.find((e) => e.path === "ui.pl.po")?.source).toContain("Zapewnia ochronę");
});

test.each(['&"ui.title"', '"""ui.title"""', '"ui.\\u0074itle"', 'r"ui.title"'])(
  "translation evidence and its fingerprint include decoded literal usage: %s",
  async (literal) => {
    const f = fixture();
    const question = presetQuestions(["translations"])[0]?.question;
    if (!question) throw new Error("Missing translation question");
    f.loaded.config.questions.methods = [];
    f.loaded.config.questions.translations = [question];
    f.write("ui.pl.po", 'msgid "ui.title"\nmsgstr "Tytuł"\n');
    const source = `func title():\n    return tr(${literal})\n`;
    f.write("ui.gd", source);
    const initial = (await f.plan()).items[0];
    expect(initial?.context.related.find((entry) => entry.path === "ui.gd")?.source).toContain(source.trimEnd());
    f.write("ui.gd", source.replace("return tr", "return format_title"));
    expect((await f.plan()).items[0]?.inputHash).not.toBe(initial?.inputHash);
  },
);

test("stock comment questions upgrade to assess missing explanations; custom rubrics remain untouched", () => {
  const initial = { version: 1, root: ".", questions: { methods: [previousComments] } };
  const upgraded = parseConfig(initial).questions.methods[0];
  expect(upgraded?.hasComments).toBe(false);
  expect(upgraded?.criteria.needs_explanation).toBeDefined();
  const custom = { ...previousComments, instructions: "My own check" };
  expect(parseConfig({ ...initial, questions: { methods: [custom] } }).questions.methods[0]?.instructions).toBe(
    "My own check",
  );
  expect(parseConfig({ ...initial, questions: { methods: [custom] } }).questions.methods[0]?.hasComments).toBe(true);
});

test("context selection preserves the target and direct callees while explicitly listing omitted supporting methods", async () => {
  const huge = "z".repeat(70_000);
  const source = "func test_value():\n    assert(Counter.value() == 1)\n";
  const context = await review(
    {
      "target.gd": source,
      "counter.gd": `class_name Counter\nstatic func value():\n    return helper()\nstatic func helper():\n    return "${huge}"\n`,
    },
    { group: "tests", references: true },
  );
  expect(context.source).toContain(source.trimEnd());
  expect(context.related.find((entry) => entry.path === "counter.gd")?.source).toContain("return helper()");
  expect(context.related.find((entry) => entry.path === "counter.gd")?.source).not.toContain("func helper");
  expect(context.unresolved?.flatMap((entry) => entry.expressions)).toContain(
    "Omitted by context allowance: counter.gd:helper",
  );
});

test("expanded context can include a complete helper that exceeded the initial allowance", async () => {
  const text = "z".repeat(70_000);
  const files = {
    "target.gd": "func test_value():\n    Counter.value()\n",
    "counter.gd": `class_name Counter\nstatic func value():\n    return helper()\nstatic func helper():\n    return "${text}"\n`,
  };
  const initial = await review(files, { group: "tests", references: true });
  const expanded = await review(files, { group: "tests", references: true, expanded: true });
  expect(initial.related.find((entry) => entry.path === "counter.gd")?.source).not.toContain(text);
  expect(expanded.related.find((entry) => entry.path === "counter.gd")?.source).toContain(text);
});

test("field documentation is included in context and its fingerprint", async () => {
  const f = fixture();
  const source =
    "class_name Policy\nvar unrelated = 0\n## Only pause when fullscreen to preserve windowed editing.\nvar pause_on_focus_loss = true\nfunc should_pause():\n    return pause_on_focus_loss\n";
  f.write("policy.gd", source);
  const before = (await f.plan()).items[0];
  f.write(
    "policy.gd",
    source.replace(
      "Only pause when fullscreen to preserve windowed editing.",
      "Always pause, including windowed play.",
    ),
  );
  const after = (await f.plan()).items[0];
  expect(before?.context.source).toContain("pause_on_focus_loss");
  expect(before?.context.source).toContain("fullscreen");
  expect(before?.inputHash).not.toBe(after?.inputHash);
});

test("declaration comments explain selected fields without introducing unrelated dependencies", async () => {
  const f = fixture();
  const source =
    "class_name Policy\nvar unrelated = 0\n## Unlike var unrelated, this flag controls pausing.\nvar enabled = true\n## Unused field documentation.\nvar unused = false\nfunc should_pause():\n    return enabled\n";
  f.write("policy.gd", source);
  const before = (await f.plan()).items[0];
  expect(before?.context.source).toContain("Unlike var unrelated");
  expect(before?.context.source).toContain("var enabled = true");
  expect(before?.context.source).not.toContain("var unrelated = 0");
  expect(before?.context.source).not.toContain("Unused field documentation");
  f.write("policy.gd", source.replace("Unused field documentation.", "Edited unused field documentation."));
  expect((await f.plan()).items[0]?.inputHash).toBe(before?.inputHash);
});

test("declaration dependencies come from identifiers, not words in strings or annotations", async () => {
  const f = fixture();
  f.write(
    "example.gd",
    'class_name Example\nvar irrelevant = 99\nconst TEXT = "irrelevant"\nconst FACTOR = 2\nconst DOUBLE = FACTOR * 2\n@export_enum("var irrelevant", "second") var choice = "second"\nfunc value():\n    return [TEXT, DOUBLE, choice]\n',
  );
  const item = (await f.plan()).items[0];
  expect(item?.context.source).toContain('const TEXT = "irrelevant"');
  expect(item?.context.source).toContain("const FACTOR = 2");
  expect(item?.context.source).toContain("const DOUBLE = FACTOR * 2");
  expect(item?.context.source).toContain('var choice = "second"');
  expect(item?.context.source).not.toContain("var irrelevant = 99");
});
