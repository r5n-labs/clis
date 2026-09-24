import { expect, test } from "bun:test";
import { createAnalysis } from "../../src/composition/analysis";
import { parseQuestion } from "../../src/config/validation";
import { ContextBuilder } from "../../src/contexts/ContextBuilder";
import { TestRunnerConvention } from "../../src/frameworks/test-runners/TestRunnerConvention";
import { TypeScriptAdapter } from "../../src/languages/typescript/TypeScriptAdapter";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fixture, response } from "../helpers";

const QUESTION = parseQuestion({
  id: "quality",
  type: "choice",
  context: "references",
  instructions: "Check the contract",
  criteria: { yes: "Matches", no: "Misleading" },
});

async function analysed(files: Record<string, string>) {
  const f = fixture();
  for (const [path, source] of Object.entries(files)) f.write(path, source);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const context = (
    name: string,
    options: {
      path?: string;
      group?: "methods" | "classes" | "tests";
      mode?: "class" | "references";
      expanded?: boolean;
    } = {},
  ) => {
    const target = project.targets.find(
      (entry) =>
        entry.name === name &&
        entry.group === (options.group ?? "methods") &&
        (!options.path || entry.path === options.path),
    );
    if (!target) throw new Error(`Missing ${name}: ${project.targets.map((entry) => entry.id).join(", ")}`);
    return new ContextBuilder(project).build(
      target,
      { ...QUESTION, context: options.mode ?? "references" },
      options.expanded,
    );
  };
  return { ...f, project, context };
}

test.each(["ts", "tsx", "mts", "cts"])(
  "extracts exact TypeScript source, comments and functions from .%s",
  async (extension) => {
    const source = "/** Adds one. */\nexport const increment = (input: number): number => input + 1;\n";
    const file = await new TypeScriptAdapter().parse(`math.${extension}`, source);
    expect(file.source).toBe(source);
    expect(file.language).toBe("TypeScript");
    const target = file.targets.find((target) => target.group === "methods");
    expect(target?.name).toBe("increment");
    expect(target?.line).toBe(2);
    expect(target?.source).toBe("export const increment = (input: number): number => input + 1;");
    expect(target?.comments).toContain("Adds one");
  },
);

test("classes, constructors, accessors, fields and overload implementations have distinct targets", async () => {
  const file = await new TypeScriptAdapter().parse(
    "counter.ts",
    `
export interface Input { value: number }
/** Counts values. */
export abstract class Counter {
  constructor(private input: Input) {}
  abstract reset(): void;
  get value() { return this.input.value; }
  set value(next: number) { this.input.value = next; }
  add = (next: number) => this.value += next;
  read(value: string): string;
  read(value: number): number;
  read(value: string | number) { return value; }
}
export const multiply = function product(n: number) { return n * 2; };
`,
  );
  expect(file.targets.filter((target) => target.group === "classes").map((target) => target.name)).toEqual(["Counter"]);
  expect(file.targets.filter((target) => target.group === "methods").map((target) => target.name)).toEqual([
    "constructor",
    "get value",
    "set value",
    "add",
    "read",
    "multiply",
  ]);
  expect(new Set(file.targets.map((target) => target.id)).size).toBe(file.targets.length);
});

test("TSX keeps component bodies, JSX and type annotations intact", async () => {
  const source = "export const Card = ({ title }: { title: string }) => <section><h1>{title}</h1></section>;";
  const file = await new TypeScriptAdapter().parse("Card.tsx", source);
  expect(file.targets.find((target) => target.name === "Card")?.source).toBe(source);
  await expect(new TypeScriptAdapter().parse("broken.ts", "export function broken( { ")).rejects.toThrow(
    "TypeScript syntax not understood",
  );
  expect(new TypeScriptAdapter().supports("card.js")).toBe(false);
});

test("parentheses and TypeScript assertions retain the named callable and its complete source", async () => {
  const source = "export const increment = ((n: number) => n + 1) satisfies (n: number) => number;";
  const file = await new TypeScriptAdapter().parse("math.ts", source);
  const target = file.targets.find((target) => target.group === "methods");
  expect(target?.name).toBe("increment");
  expect(target?.source).toBe(source);
});

test("relative imports, aliases, barrel exports, constructors and local helpers supply implementations", async () => {
  const f = await analysed({
    "entry.ts":
      'import { Counter as Count } from "./barrel.js";\nexport function total() { const counter = new Count(); return counter.value(); }',
    "barrel.ts": 'export { Counter } from "./counter";',
    "counter.ts":
      'export class Counter { private count = 1; constructor() { this.count = 2; } value() { return this.helper(); } private helper() { return this.count; } unrelated() { return "UNRELATED"; } }',
  });
  const context = f.context("total");
  const related = context.related.find((entry) => entry.path === "counter.ts")?.source;
  expect(related).toContain("constructor() { this.count = 2; }");
  expect(related).toContain("value() { return this.helper(); }");
  expect(related).toContain("private helper() { return this.count; }");
  expect(related).not.toContain("UNRELATED");
  expect(context.related.some((entry) => entry.path === "barrel.ts")).toBe(true);
});

test("namespace imports resolve implementations through declared input types", async () => {
  const f = await analysed({
    "entry.ts":
      'import * as types from "./counter"; export function total(input: types.Counter) { return input.value(); }',
    "counter.ts": "export class Counter { value() { return 42; } }",
  });
  expect(f.context("total").related.find((entry) => entry.path === "counter.ts")?.source).toContain(
    "value() { return 42; }",
  );
});

test("default imports resolve implementations through declared factory return types", async () => {
  const f = await analysed({
    "entry.ts":
      'import Factory from "./factory"; export function total() { const created = Factory.make(); return created.value(); }',
    "factory.ts":
      'import { Counter } from "./counter"; export default class Factory { static make(): Counter { return new Counter(); } }',
    "counter.ts": "export class Counter { value() { return 42; } }",
  });
  const context = f.context("total");
  expect(context.related.find((entry) => entry.path === "factory.ts")?.source).toContain(
    "static make(): Counter { return new Counter(); }",
  );
  expect(context.related.find((entry) => entry.path === "counter.ts")?.source).toContain("value() { return 42; }");
});

test("overridden methods retain inherited contracts in local context", async () => {
  const f = await analysed({
    "override.ts": 'import { Base } from "./base"; export class Free extends Base { pay() { return true; } }',
    "base.ts":
      "/** Payment policies may explicitly bypass payment. */ export abstract class Base { pay() { return false; } }",
  });
  const local = f.context("pay", { path: "override.ts", mode: "class" });
  expect(local.related.find((entry) => entry.path === "base.ts")?.source).toContain(
    "Payment policies may explicitly bypass payment.",
  );
  expect(local.related.find((entry) => entry.path === "base.ts")?.source).toContain("pay() { return false; }");
});

test("shadowed parameters, reassigned locals and unresolved package imports are never guessed", async () => {
  const f = await analysed({
    "entry.ts":
      'import { Counter } from "./counter"; import { external } from "not-installed"; export function shadow(Counter: unknown) { return Counter.value(); } export function changed() { let counter = new Counter(); counter = mystery(); return counter.value(); } export function missing() { return external(); }',
    "counter.ts": 'export class Counter { value() { return "SHOULD_NOT_BE_GUESSED"; } }',
  });
  for (const name of ["shadow", "changed"])
    expect(JSON.stringify(f.context(name))).not.toContain("SHOULD_NOT_BE_GUESSED");
  expect(JSON.stringify(f.context("missing").unresolved)).toContain("external()");
});

test.each(["bun:test", "vitest", "@jest/globals"])(
  "%s recognises aliased tests, suites, fixtures and each without running code",
  async (runner) => {
    const f = await analysed({
      "counter.test.ts": `import { test as check, describe, beforeEach } from "${runner}"; import { Counter } from "./counter";
describe("counter", () => { let input: Counter; beforeEach(() => { input = new Counter(); }); check.each([1,2])("returns a count", () => { expect(input.value()).toBe(1); }); });
describe("unrelated", () => { beforeEach(() => { unrelated_setup(); }); check("another count", () => {}); });`,
      "counter.ts": "export class Counter { value() { return 1; } }",
    });
    const context = f.context("returns a count", { group: "tests" });
    expect(context.source).toContain("beforeEach(() => { input = new Counter(); })");
    expect(context.source).not.toContain("unrelated_setup");
    expect(context.related.find((entry) => entry.path === "counter.ts")?.source).toContain("value()");
    expect(f.project.targets.filter((target) => target.group === "tests")).toHaveLength(2);
  },
);

test("test conventions are injectable and do not classify arbitrary application callbacks", async () => {
  const source = 'import { test } from "vitest"; test("example", () => {});';
  expect(
    (await new TypeScriptAdapter().parse("example.test.ts", source)).targets.some((target) => target.group === "tests"),
  ).toBe(false);
  const adapter = new TypeScriptAdapter([new TestRunnerConvention("@jest/globals")]);
  expect(
    (await adapter.parse("example.spec.ts", 'test("example", () => {});')).targets.some(
      (target) => target.group === "tests",
    ),
  ).toBe(true);
  for (const source of [
    'import { test } from "application"; test("example", () => {});',
    'function run(test: Function) { test("example", () => {}); }',
  ])
    expect((await adapter.parse("example.spec.ts", source)).targets.some((target) => target.group === "tests")).toBe(
      false,
    );
});

test("duplicate test titles remain independently addressable", async () => {
  const file = await new TypeScriptAdapter([new TestRunnerConvention("bun:test")]).parse(
    "example.test.ts",
    'import { test } from "bun:test"; test("same", () => {}); test("same", () => {});',
  );
  expect(file.targets.filter((target) => target.group === "tests")).toHaveLength(2);
  expect(new Set(file.targets.map((target) => target.id)).size).toBe(file.targets.length);
});

test("selected dependency edits invalidate cached answers while unrelated implementation edits do not", async () => {
  const f = fixture();
  f.loaded.config.questions.methods = [QUESTION];
  f.write("entry.ts", 'import { value } from "./value"; export function total() { return value(); }');
  const dependency = "export function value() { return 1; } export function unrelated() { return 9; }";
  f.write("value.ts", dependency);
  const first = await f.plan();
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    first,
    new RequestBatcher().batches(first, f.loaded.config),
  );
  f.write("value.ts", dependency.replace("return 9", "return 999"));
  expect((await f.plan()).items.find((entry) => entry.target.name === "total")?.evaluation).toBeDefined();
  f.write("value.ts", dependency.replace("return 1", "return 2"));
  expect((await f.plan()).items.find((entry) => entry.target.name === "total")?.evaluation).toBeUndefined();
});

test("literal usage enables format-independent translation evidence", async () => {
  const f = await analysed({ "view.ts": 'export function title() { return translate("screen.title"); }' });
  const usages = f.project.analysis.literalUsages(f.project, "screen.title");
  expect(usages).toHaveLength(1);
  expect(usages[0]?.containsLiteral("screen.title")).toBe(true);
  expect(usages[0]?.containsLiteral("unrelated")).toBe(false);
});

test("named default exports and overload signatures keep both implementation and contract", async () => {
  const f = await analysed({
    "entry.ts": 'import Factory from "./factory"; export function total() { return Factory.make().read(1); }',
    "factory.ts":
      'import { Counter } from "./counter"; export default class Factory { static make(): Counter { return new Counter(); } }',
    "counter.ts":
      "export class Counter { read(value: number): number; read(value: string): string; read(value: string | number) { return value; } }",
  });
  const context = f.context("total", { expanded: true });
  const source = context.related.find((entry) => entry.path === "counter.ts")?.source;
  expect(source).toContain("read(value: number): number");
  expect(source).toContain("read(value: string): string");
  expect(source).toContain("return value;");
});

test("hoisted and later declarations shadow runner globals and imports", async () => {
  const adapter = new TypeScriptAdapter([
    new TestRunnerConvention("@jest/globals"),
    new TestRunnerConvention("vitest"),
  ]);
  for (const source of [
    'test("application", () => {}); function test(title: string, callback: Function) {}',
    'import { test } from "vitest"; function run() { test("application", () => {}); const test = application; }',
  ])
    expect(
      (await adapter.parse("example.spec.ts", source)).targets.filter((target) => target.group === "tests"),
    ).toEqual([]);
});

test("generic parameters and nested regular-function this do not resolve to an outer class", async () => {
  const f = await analysed({
    "entry.ts":
      'import { Counter } from "./counter"; export function generic<Counter>(input: Counter) { return input.read(); } export function make<Counter>(): Counter { return unknownValue; } export function readMade() { return make().read(); } export class Owner { read() { return "OUTER_BODY"; } run() { function nested() { return this.read(); } return nested(); } }',
    "counter.ts": 'export class Counter { read() { return "UNRELATED_TYPE"; } }',
  });
  expect(JSON.stringify(f.context("generic"))).not.toContain("UNRELATED_TYPE");
  expect(JSON.stringify(f.context("readMade"))).not.toContain("UNRELATED_TYPE");
  expect(f.context("run").source).not.toContain("OUTER_BODY");
});

test("TypeScript assertions, .mjs/.cjs substitution and import-equals resolve included declarations", async () => {
  const f = await analysed({
    "entry.cts":
      'import Counter = require("./counter.cjs"); import { other } from "./other.mjs"; export function total(input: unknown) { return (<Counter>input).read() + other(); }',
    "counter.cts": "class Counter { read() { return 7; } } export = Counter;",
    "other.mts": "export function other() { return 11; }",
  });
  const source = JSON.stringify(f.context("total").related);
  expect(source).toContain("return 7");
  expect(source).toContain("return 11");
});

test("re-export cycles terminate and conflicting stars remain explicitly unresolved", async () => {
  const f = await analysed({
    "entry.ts": 'import { value } from "./barrel"; export function total() { return value(); }',
    "barrel.ts": 'export * from "./cycle"; export * from "./left"; export * from "./right";',
    "cycle.ts": 'export * from "./barrel";',
    "left.ts": 'export function value() { return "LEFT"; }',
    "right.ts": 'export function value() { return "RIGHT"; }',
  });
  expect(JSON.stringify(f.context("total").unresolved)).toContain("value()");
});

test("complete targets survive a small context allowance and omissions are explicit", async () => {
  const f = await analysed({
    "entry.ts": 'import { helper } from "./helper"; export function total() { return helper(); }',
    "helper.ts": 'export function helper() { return "IMPLEMENTATION"; }',
  });
  const target = f.project.targets.find((target) => target.name === "total");
  if (!target) throw new Error("Expected total target");
  const context = f.project.analysis
    .context(f.project, "entry.ts")
    .references?.select(target, { sourceBytes: 1, depth: 1 });
  expect(context?.source).toContain(target.source);
  expect(context?.related.size).toBe(0);
  expect(JSON.stringify(context?.unresolved)).toContain("Omitted by context allowance");
  expect(f.context("total", { mode: "class" }).related).toHaveLength(0);
  expect(f.context("total").related[0]?.source).toContain("IMPLEMENTATION");
});

test("unrelated method comments are not inherited as class documentation", async () => {
  const f = await analysed({
    "owner.ts":
      "/** Owns the counter. */ export class Owner { run() { return 1; } /** UNRELATED_DOC */ other() { return 2; } }",
  });
  const context = f.context("run");
  expect(context.source).toContain("Owns the counter");
  expect(context.source).not.toContain("UNRELATED_DOC");
});

test("reassigned class fields do not claim their original initializer remains the implementation", async () => {
  const f = await analysed({
    "owner.ts":
      'import { Counter } from "./counter"; export class Owner { counter = new Counter(); replace() { this.counter = unknownCounter(); } run() { return this.counter.read(); } }',
    "counter.ts": 'export class Counter { read() { return "STALE_BODY"; } }',
  });
  expect(JSON.stringify(f.context("run"))).not.toContain("STALE_BODY");
  expect(JSON.stringify(f.context("run").unresolved)).toContain("this.counter.read()");
});

test("constructor parameter properties resolve their declared type and closures retain input preparation", async () => {
  const f = await analysed({
    "entry.ts":
      'import { Counter } from "./counter"; export class Owner { constructor(readonly input: Counter) {} run() { return this.input.read(); } } export function setup() { const initial = 7; function readInitial() { return initial; } return readInitial(); }',
    "counter.ts": 'export class Counter { read() { return "CONSTRUCTOR_INPUT"; } }',
  });
  expect(JSON.stringify(f.context("run").related)).toContain("CONSTRUCTOR_INPUT");
  expect(f.context("readInitial").source).toContain("const initial = 7;");
});

test("class and object members are not mistaken for unqualified lexical functions", async () => {
  const f = await analysed({
    "entry.ts":
      'function read() { return "LEXICAL_READ"; } export class Owner { read() { return "CLASS_READ"; } run() { return read(); } } export const object = { read() { return "OBJECT_READ"; }, run() { return read(); } }; export function instance(owner: Owner) { return owner.read(); }',
  });
  for (const target of f.project.targets.filter(
    (target) => target.group === "methods" && target.name.startsWith("run"),
  )) {
    const context = new ContextBuilder(f.project).build(target, QUESTION);
    expect(context.source).toContain("LEXICAL_READ");
    expect(context.source).not.toContain("CLASS_READ");
    expect(context.source).not.toContain("OBJECT_READ");
  }
  expect(f.context("instance").source).toContain("CLASS_READ");
});

test("object arrows retain lexical this while methods bind the object", async () => {
  const f = await analysed({
    "entry.ts":
      'export const object = { read() { return "OBJECT_BODY"; }, arrow: () => this.read(), method() { return this.read(); } };',
  });
  expect(f.context("arrow").source).not.toContain("OBJECT_BODY");
  expect(JSON.stringify(f.context("arrow").unresolved)).toContain("this.read()");
  expect(f.context("method").source).toContain("OBJECT_BODY");
});
