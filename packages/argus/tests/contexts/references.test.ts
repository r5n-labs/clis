import { expect, test } from "bun:test";
import { createAnalysis } from "../../src/composition/analysis";
import { parseQuestion } from "../../src/config/validation";
import { ContextBuilder } from "../../src/contexts/ContextBuilder";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fixture, response } from "../helpers";

const QUESTION = parseQuestion({
  id: "quality",
  type: "choice",
  context: "references",
  instructions: "Does this test establish the claimed behaviour?",
  criteria: { yes: "Established", no: "Not established" },
});

test("fixture-loaded scripts supply possible implementations for dynamic receivers without claiming resolution", async () => {
  const result = await context({
    "test.gd":
      'const EFFECT = preload("res://effect.gd")\nconst UNUSED = preload("res://unused.gd")\nvar effect: Variant\nfunc setup():\n    effect = track(EFFECT.new())\nfunc teardown():\n    effect = null\nfunc test_echo():\n    effect.show_echo()\n    assert(effect.get_child_count() == 1)\n',
    "effect.gd":
      "extends Node2D\nfunc show_echo():\n    add_echo()\nfunc add_echo():\n    add_child(Sprite2D.new())\nfunc unrelated():\n    pass\n",
    "unused.gd": "func show_echo():\n    pass\n",
  });
  const source = result.context.related.find((entry) => entry.path === "effect.gd")?.source;
  expect(source).toContain("func show_echo");
  expect(source).toContain("func add_echo");
  expect(source).not.toContain("func unrelated");
  expect(result.context.related.some((entry) => entry.path === "unused.gd")).toBe(false);
  expect(result.context.source).toContain("func setup");
  expect(result.context.unresolved?.flatMap((entry) => entry.expressions).join("\n")).toContain(
    "receiver identity is not established by static analysis",
  );
});

async function context(files: Record<string, string>, options: { group?: "tests" | "classes"; name?: string } = {}) {
  const f = fixture();
  for (const [path, source] of Object.entries(files)) f.write(path, source);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const target = project.targets.find(
    (entry) =>
      entry.path === "test.gd" &&
      entry.group === (options.group ?? "tests") &&
      (!options.name || entry.name === options.name),
  );
  if (!target) throw new Error("Missing test target");
  return { target, context: new ContextBuilder(project).build(target, QUESTION) };
}

test("constructor receivers include called methods, initialisers and recursive local helpers, not unrelated methods", async () => {
  const result = await context({
    "test.gd": "func test_value():\n    var counter = Counter.new()\n    assert(counter.value() == 1)\n",
    "counter.gd":
      "class_name Counter\nvar count = 0\nfunc _init():\n    count = 1\nfunc value():\n    return self.helper()\nfunc helper():\n    return tail()\nfunc tail():\n    return count\nfunc unrelated():\n    return 999\n",
  });
  const source = result.context.related.find((entry) => entry.path === "counter.gd")?.source;
  expect(source).toContain("func _init");
  expect(source).toContain("func value");
  expect(source).toContain("func helper");
  expect(source).toContain("func tail");
  expect(source).toContain("var count = 0");
  expect(source).not.toContain("func unrelated");
  expect(source).toContain("other methods omitted");
});

test("typed parameters, casts, preload aliases and declared returns resolve across scripts", async () => {
  const result = await context({
    "test.gd":
      'const Maker = preload("res://factory.gd")\nfunc test_value(input: Counter):\n    var alias = input\n    var casted = find_something() as Counter\n    var created = Maker.create()\n    alias.value()\n    casted.value()\n    created.value()\n',
    "factory.gd": 'func create() -> Counter:\n    return Counter.new()\nfunc unrelated():\n    return "omit"\n',
    "counter.gd": "class_name Counter\nfunc value():\n    return 1\nfunc unrelated():\n    pass\n",
  });
  expect(result.context.related.find((entry) => entry.path === "factory.gd")?.source).toContain("func create");
  expect(result.context.related.find((entry) => entry.path === "counter.gd")?.source).toContain("func value");
  expect(result.context.related.every((entry) => !entry.source.includes("func unrelated"))).toBe(true);
  expect(
    result.context.unresolved
      ?.flatMap((entry) => entry.expressions)
      .some((entry) => entry.includes("find_something()")),
  ).toBe(true);
});

test("typed fields and local test helpers bring their cross-file dependencies", async () => {
  const result = await context({
    "test.gd":
      "func test_value():\n    assert(helper() == 1)\nfunc helper():\n    var owner = Owner.new()\n    return owner.counter.value()\nfunc ignored():\n    pass\n",
    "owner.gd": "class_name Owner\nvar counter: Counter\nfunc ignored():\n    pass\n",
    "counter.gd": "class_name Counter\nfunc value():\n    return 1\n",
  });
  expect(result.context.source).toContain("func helper");
  expect(result.context.source).not.toContain("func ignored");
  expect(result.context.related.find((entry) => entry.path === "counter.gd")?.source).toContain("func value");
});

test("ambiguous or reassigned inferred receivers stay explicitly unresolved", async () => {
  const result = await context({
    "test.gd":
      'func test_value():\n    var receiver = Counter.new()\n    receiver = mystery()\n    receiver.value()\n    dynamic.call("value")\n',
    "counter.gd": "class_name Counter\nfunc value():\n    return 1\n",
  });
  expect(result.context.related.find((entry) => entry.path === "counter.gd")?.source).not.toContain("func value");
  expect(
    result.context.unresolved
      ?.flatMap((entry) => entry.expressions)
      .some((entry) => entry.includes("receiver.value()")),
  ).toBe(true);
  expect(
    result.context.unresolved?.flatMap((entry) => entry.expressions).some((entry) => entry.includes("dynamic.call()")),
  ).toBe(true);
});

test("duplicate global names are not guessed and untyped locals shadow global classes", async () => {
  const result = await context({
    "test.gd": "func test_value(Counter):\n    Counter.value()\n    Duplicate.value()\n",
    "counter.gd": "class_name Counter\nstatic func value():\n    return 1\n",
    "first.gd": "class_name Duplicate\nstatic func value():\n    return 1\n",
    "second.gd": "class_name Duplicate\nstatic func value():\n    return 2\n",
  });
  expect(result.context.related).toHaveLength(0);
  expect(
    result.context.unresolved?.flatMap((entry) => entry.expressions).some((entry) => entry.includes("Counter.value()")),
  ).toBe(true);
  expect(
    result.context.unresolved
      ?.flatMap((entry) => entry.expressions)
      .some((entry) => entry.includes("Duplicate.value()")),
  ).toBe(true);
});

test("inheritance and recursive call cycles terminate with each method included once", async () => {
  const result = await context({
    "test.gd": "func test_value():\n    var derived = Derived.new()\n    derived.value()\n",
    "derived.gd": "class_name Derived\nextends Base\nfunc unused():\n    pass\n",
    "base.gd": "class_name Base\nfunc value():\n    return helper()\nfunc helper():\n    return value()\n",
  });
  const source = result.context.related.find((entry) => entry.path === "base.gd")?.source ?? "";
  expect(source.match(/func value/g)).toHaveLength(1);
  expect(source.match(/func helper/g)).toHaveLength(1);
  expect(result.context.related.find((entry) => entry.path === "derived.gd")?.source).not.toContain("func unused");
});

test("nested classes retain their own declarations and resolve their base methods", async () => {
  const result = await context({
    "test.gd": "func test_value():\n    var inner = Outer.Inner.new()\n    inner.value()\n",
    "outer.gd":
      "class_name Outer\nvar outer_only = 1\nclass Inner extends Base:\n    var inner_only = 2\n    func unused():\n        pass\n",
    "base.gd": "class_name Base\nfunc value():\n    return 1\n",
  });
  expect(result.context.related.find((entry) => entry.path === "base.gd")?.source).toContain("func value");
  expect(result.context.related.find((entry) => entry.path === "outer.gd")?.source).toContain(
    "class Inner extends Base:",
  );
});

test("whole-class architecture source stays intact while referenced implementations are narrowed", async () => {
  const source = "class_name Coordinator\nfunc first():\n    return Counter.value()\nfunc second():\n    return 2\n";
  const result = await context(
    {
      "test.gd": source,
      "counter.gd": "class_name Counter\nstatic func value():\n    return 1\nfunc unrelated():\n    pass\n",
    },
    { group: "classes" },
  );
  expect(result.context.source).toBe(result.target.source);
  expect(result.context.source).toContain("func second");
  expect(result.context.related.find((entry) => entry.path === "counter.gd")?.source).toContain("func value");
  expect(result.context.related.find((entry) => entry.path === "counter.gd")?.source).not.toContain("func unrelated");
});

test("literal data resources remain complete and explicit contextFiles override selected snippets", async () => {
  const f = fixture("all");
  f.write(
    "test.gd",
    'const DATA = preload("res://data.tres")\nfunc test_value():\n    assert(DATA != null)\n    Counter.value()\n',
  );
  f.write("data.tres", '[gd_resource type="Resource" format=3]\n[resource]\nvalue = 5\n');
  f.write("counter.gd", "class_name Counter\nstatic func value():\n    return 1\nfunc unrelated():\n    pass\n");
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const target = project.targets.find((entry) => entry.group === "tests");
  if (!target) throw new Error("Missing test");
  const result = new ContextBuilder(project).build(target, { ...QUESTION, contextFiles: ["counter.gd"] });
  expect(result.related.find((entry) => entry.path === "data.tres")?.source).toBe(
    project.files.get("data.tres")?.source,
  );
  expect(result.related.find((entry) => entry.path === "counter.gd")?.source).toContain("func unrelated");
});

test("unrelated method edits reuse cached reference checks; selected helper edits invalidate them", async () => {
  const f = fixture();
  f.loaded.config.questions.methods = [];
  f.loaded.config.questions.tests = [QUESTION];
  f.write("test.gd", "func test_value():\n    Counter.value()\n");
  const source =
    "class_name Counter\nstatic func value():\n    return helper()\nstatic func helper():\n    return 1\nstatic func unrelated():\n    return 9\n";
  f.write("counter.gd", source);
  const first = await f.plan();
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(first, new RequestBatcher().batches(first, f.loaded.config));
  f.write("counter.gd", source.replace("return 9", "return 999"));
  expect((await f.plan()).items[0]?.evaluation).toBeDefined();
  f.write("counter.gd", source.replace("return 1", "return 2"));
  expect((await f.plan()).items[0]?.evaluation).toBeUndefined();
});

test("large selected implementations stay blocked without truncation", async () => {
  const f = fixture();
  f.loaded.config.questions.methods = [];
  f.loaded.config.questions.tests = [QUESTION];
  f.loaded.config.maxRequestBytes = 2000;
  const source = `class_name Counter\nstatic func value():\n    return "${"x".repeat(4000)}"\n`;
  f.write("counter.gd", source);
  f.write("test.gd", "func test_value():\n    Counter.value()\n");
  const item = (await f.plan()).items[0];
  expect(item?.blocked).toContain("request limit");
  expect(item?.context.related[0]?.source).toContain("x".repeat(4000));
});

test("symbol extraction does not treat strings and comments as calls", async () => {
  const result = await context({
    "test.gd": 'func test_value():\n    # Counter.value()\n    var text = "Counter.value()"\n    pass\n',
    "counter.gd": "class_name Counter\nstatic func value():\n    return 42\n",
  });
  expect(result.context.related).toEqual([]);
  expect(result.context.unresolved ?? []).toEqual([]);
});

test("external methods keep local helpers but mark further cross-file calls unresolved", async () => {
  const result = await context({
    "test.gd": "func test_value():\n    First.value()\n",
    "first.gd":
      "class_name First\nstatic func value():\n    return helper()\nstatic func helper():\n    return Second.value()\n",
    "second.gd": "class_name Second\nstatic func value():\n    return 1\n",
  });
  expect(result.context.related.map((entry) => entry.path)).toEqual(["first.gd"]);
  expect(result.context.related[0]?.source).toContain("func helper");
  expect(
    result.context.unresolved?.flatMap((entry) => entry.expressions).some((entry) => entry.includes("Second.value()")),
  ).toBe(true);
  expect(result.context.referenceScope).toContain("Further cross-file dependencies are unresolved");
});

test("unused preload declarations do not bring unrelated implementations or resources", async () => {
  const result = await context({
    "test.gd":
      'const UNUSED = preload("res://unused.gd")\nconst DATA = preload("res://scene.tscn")\nfunc test_value():\n    Counter.value()\n',
    "unused.gd": "func unused():\n    pass\n",
    "scene.tscn": '[gd_scene format=3]\n[node name="Root" type="Node"]\n',
    "counter.gd": "class_name Counter\nstatic func value():\n    return 1\n",
  });
  expect(result.context.related.map((entry) => entry.path)).toEqual(["counter.gd"]);
});

test("plain path strings are not mistaken for loaded script instances", async () => {
  const result = await context({
    "test.gd": 'const PATH = "res://counter.gd"\nfunc test_value():\n    PATH.value()\n',
    "counter.gd": "class_name Counter\nstatic func value():\n    return 1\n",
  });
  expect(result.context.related).toHaveLength(0);
  expect(
    result.context.unresolved?.flatMap((entry) => entry.expressions).some((entry) => entry.includes("PATH.value()")),
  ).toBe(true);
});

test.each(['"res://co\\u0075nter.gd"', '"""res://counter.gd"""', 'r"res://counter.gd"'])(
  "decoded preload paths resolve their methods: %s",
  async (literal) => {
    const result = await context({
      "test.gd": `const CounterScript = preload(${literal})\nfunc test_value():\n    CounterScript.new().value()\n`,
      "counter.gd": "func value():\n    return 42\n",
    });
    expect(result.context.related.find((entry) => entry.path === "counter.gd")?.source).toContain("return 42");
  },
);

test("used typed field initialisers retain constructor dependencies", async () => {
  const result = await context({
    "test.gd": "var counter: Counter = Counter.new()\nfunc test_value():\n    counter.value()\n",
    "counter.gd":
      "class_name Counter\nvar number = 0\nfunc _init():\n    number = 1\nfunc value():\n    return number\n",
  });
  expect(result.context.related[0]?.source).toContain("func _init");
  expect(result.context.related[0]?.source).toContain("func value");
});

test("match bindings shadow global classes without guessing receiver types", async () => {
  const result = await context({
    "test.gd": "func test_value(input):\n    match input:\n        var Counter:\n            Counter.value()\n",
    "counter.gd": "class_name Counter\nstatic func value():\n    return 1\n",
  });
  expect(result.context.related).toHaveLength(0);
  expect(result.context.unresolved?.flatMap((entry) => entry.expressions)).toContain("Counter.value()");
});

test("typed constant preload aliases resolve their actual script", async () => {
  const result = await context({
    "test.gd":
      'const CounterScript: GDScript = preload("res://counter.gd")\nfunc test_value():\n    var counter = CounterScript.new()\n    counter.value()\n',
    "counter.gd": "func value():\n    return 1\nfunc unrelated():\n    pass\n",
  });
  expect(result.context.related[0]?.source).toContain("func value");
  expect(result.context.related[0]?.source).not.toContain("func unrelated");
});

test("unresolved field initialisers are disclosed even when their declared type is known", async () => {
  const result = await context({
    "test.gd": "var counter: Counter = get_unknown_counter()\nfunc test_value():\n    counter.value()\n",
    "counter.gd": "class_name Counter\nfunc value():\n    return 1\n",
  });
  expect(result.context.related[0]?.source).toContain("func value");
  expect(result.context.unresolved?.flatMap((entry) => entry.expressions)).toContain("get_unknown_counter()");
});
