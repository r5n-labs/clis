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
  id: "contract",
  type: "choice",
  context: "references",
  instructions: "Check the implementation",
  criteria: { yes: "Correct", no: "Incorrect" },
});

async function analyse(source: string, files: Record<string, string> = {}) {
  const f = fixture();
  f.write("entry.ts", source);
  for (const [path, text] of Object.entries(files)) f.write(path, text);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const context = (name: string, owner?: string) => {
    const target = project.targets.find(
      (entry) => entry.name === name && entry.group === "methods" && (!owner || entry.owner === owner),
    );
    if (!target) throw new Error(`Missing target ${name}`);
    const context = new ContextBuilder(project).build(target, QUESTION);
    return { ...context, unresolved: context.unresolved ?? [] };
  };
  return { ...f, project, context };
}

test.each(["ts", "tsx"])("type-only star re-exports preserve source and resolve contracts in %s", async (extension) => {
  const source = '/** Public types. */\nexport type * from "./contract";\nexport type * as names from "./contract";\n';
  const parsed = await new TypeScriptAdapter().parse(`barrel.${extension}`, source);
  expect(parsed.source).toBe(source);
  const f = await analyse(
    'import type { Contract, names } from "./barrel"; export function run(a: Contract, b: names.Contract) { return [a, b]; }',
    { [`barrel.${extension}`]: source, "contract.ts": "export interface Contract { required: string }" },
  );
  const context = f.context("run");
  for (const line of source.trim().split("\n"))
    expect(context.related.find((entry) => entry.path === `barrel.${extension}`)?.source).toContain(line);
  expect(context.related.find((entry) => entry.path === "contract.ts")?.source).toContain("required: string");
  expect(context.unresolved).toEqual([]);
  for (const invalid of ["export type *;", "export type * as names;", "export type * from;"])
    await expect(new TypeScriptAdapter().parse(`invalid.${extension}`, invalid)).rejects.toThrow(
      "syntax not understood",
    );
});

test.each(["ts", "tsx"])("import types compose with arrays and indexed types in %s", async (extension) => {
  const source =
    '/** Imported contract. */\nexport type Contract = { domain: import("ethers").TypedDataDomain; types: Record<string, import("ethers").TypedDataField[]>; field: import("ethers").TypedDataField["name"]; };\nexport function run(input: Contract) { return input; }\n';
  const adapter = new TypeScriptAdapter();
  const parsed = await adapter.parse(`entry.${extension}`, source);
  expect(parsed.source).toBe(source);
  expect(parsed.targets.find((entry) => entry.name === "run")?.line).toBe(3);
  for (const invalid of ['type A = import("ethers").;', 'type A = import("ethers").Field[;'])
    await expect(adapter.parse(`invalid.${extension}`, invalid)).rejects.toThrow("syntax not understood");
});

test.each(['export function run() { if (true) { var helper = () => "INNER_RIGHT"; } return helper(); }'])(
  "nested var binds to its declaration owner: %s",
  async (body) => {
    const f = await analyse(`function helper() { return "OUTER_WRONG"; } ${body}`);
    expect(f.context("run").source).not.toContain("OUTER_WRONG");
  },
);

test("hoisted var initialisers keep their lexical scope and closure bindings", async () => {
  const f = await analyse(
    'function helper() { return "OUTER_WRONG"; } export function prepare() { { const local = () => "INNER_RIGHT"; var chosen = local; var closure = () => local(); } function run() { return chosen() + closure(); } return run(); }',
  );
  const context = f.context("run");
  expect(context.source).toContain("INNER_RIGHT");
  expect(context.source).not.toContain("OUTER_WRONG");
  expect(JSON.stringify(context.unresolved)).not.toContain("chosen()");
  expect(JSON.stringify(context.unresolved)).not.toContain("local()");
});

test("module var initialisers resolve after nested blocks and preserve full declarations", async () => {
  const f = await analyse(
    'if (true) { const local = () => "MODULE_RIGHT"; var helper = local; } export function run() { return helper(); }',
  );
  expect(f.context("run").source).toContain('const local = () => "MODULE_RIGHT";');
  expect(f.context("run").source).toContain("var helper = local;");
  expect(f.context("run").unresolved).toEqual([]);
});

test("function-body declarations and nested var share an ambiguous declaration binding", async () => {
  const f = await analyse(
    'export function run() { function helper() { return "FIRST"; } if (condition) { var helper = () => "REPLACED"; } return helper(); }',
  );
  expect(JSON.stringify(f.context("run").unresolved)).toContain("helper()");
});

test("var class initialisers retain their block-local declared dependencies", async () => {
  const f = await analyse(
    'function helper() { return "OUTER_WRONG"; } export function prepare() { { const helper = () => "INNER_RIGHT"; var Chosen = class Internal { static run() { return helper(); } }; } function call() { return Chosen.run(); } return call(); }',
  );
  expect(f.context("call").source).toContain("INNER_RIGHT");
  expect(f.context("call").source).not.toContain("OUTER_WRONG");
  expect(f.context("call").unresolved).toEqual([]);
});

test.each([
  'function run() { test("application", () => {}); if (false) { var test = ordinary; } }',
  'test("application", () => {}); if (false) { var test = ordinary; }',
  'import { test } from "vitest"; function run() { test("application", () => {}); for (;;) { var test = ordinary; break; } }',
  'function run() { test("application", () => {}); for (var test of values) {} }',
  'function run() { test("application", () => {}); try {} catch { var { test } = ordinary; } }',
])("nested var shadows runner names before declarations: %s", async (source) => {
  const adapter = new TypeScriptAdapter([
    new TestRunnerConvention("@jest/globals"),
    new TestRunnerConvention("vitest"),
  ]);
  expect((await adapter.parse("entry.test.ts", source)).targets.filter((target) => target.group === "tests")).toEqual(
    [],
  );
});

test.each([
  'if (true) { let helper = () => "INNER_WRONG"; }',
  'function nested() { var helper = () => "INNER_WRONG"; }',
  'class Nested { static { var helper = () => "INNER_WRONG"; } }',
  "for (let helper of values) {}",
])("lexical and nested declaration boundaries preserve outer helpers: %s", async (body) => {
  const f = await analyse(
    `function helper() { return "OUTER_RIGHT"; } export function run() { ${body} return helper(); }`,
  );
  expect(f.context("run").source).toContain("OUTER_RIGHT");
});

test.each(["function helper() { return helper(); }", "function* helper() { yield helper(); }"])(
  "named function expressions keep private recursive bindings: %s",
  async (callback) => {
    const f = await analyse(
      `function helper() { return "OUTER_RIGHT"; } export function run() { values.map(${callback}); return helper(); }`,
    );
    expect(f.context("run").source).toContain("OUTER_RIGHT");
    const privateContext = f.context("helper", "entry.ts.run");
    expect(privateContext.source).not.toContain("OUTER_RIGHT");
    expect(JSON.stringify(privateContext.unresolved)).not.toContain("helper()");
  },
);

test("named class expressions keep outer and private bindings separate", async () => {
  const f = await analyse(
    'class Helper { static read() { return "OUTER_RIGHT"; } } export function run() { values.push(class Helper { static read() { return "INNER_PRIVATE"; } self() { return Helper.read(); } }); return Helper.read(); }',
  );
  expect(f.context("run").source).toContain("OUTER_RIGHT");
  expect(f.context("self").source).toContain("INNER_PRIVATE");
  expect(f.context("self").source).not.toContain("OUTER_RIGHT");
});

test("external variable names remain callable for named expressions", async () => {
  const f = await analyse(
    "const external = function internal() { return internal(); }; const External = class Internal { static read() { return Internal; } }; export function run() { return external() + External.read(); }",
  );
  expect(f.context("run").source).toContain("function internal()");
  expect(f.context("run").source).toContain("static read()");
  expect(f.context("run").unresolved).toEqual([]);
});

test("nested object members belong to their immediate owner", async () => {
  const f = await analyse(
    'const object = { helper() { return "OUTER_WRONG"; }, nested: { helper() { return "INNER_RIGHT"; }, run() { return this.helper(); } } }; export function call() { return object.nested.run(); }',
  );
  expect(f.context("run").source).toContain("INNER_RIGHT");
  expect(f.context("run").source).not.toContain("OUTER_WRONG");
  expect(f.context("run").unresolved).toEqual([]);
  expect(JSON.stringify(f.context("call").unresolved)).not.toContain("object.nested.run()");
});

test.each([
  'const object = { helper() { return "OUTER_WRONG"; }, nested: { run() { return this.helper(); } } };',
  'class Owner { helper() { return "OUTER_WRONG"; } create() { return { run() { return this.helper(); } }; } }',
  'class Owner { helper() { return "OUTER_WRONG"; } create() { const object = ({ run() { return this.helper(); } }); return object; } }',
  'class Owner { helper() { return "OUTER_WRONG"; } create() { const object = { run() { return this.helper(); } } as object; return object; } }',
])("all object literals form method ownership boundaries: %s", async (source) => {
  const f = await analyse(source);
  expect(f.context("run").source).not.toContain("OUTER_WRONG");
  expect(JSON.stringify(f.context("run").unresolved)).toContain("this.helper()");
});

test("nested object arrows retain lexical this and methods retain lexical identifiers", async () => {
  const f = await analyse(
    'function helper() { return "LEXICAL_RIGHT"; } class Owner { helper() { return "CLASS_RIGHT"; } create() { return { helper() { return "OBJECT_WRONG"; }, nested: { arrow: () => this.helper(), run() { return helper(); } } }; } }',
  );
  expect(f.context("arrow").source).toContain("CLASS_RIGHT");
  expect(f.context("arrow").source).not.toContain("OBJECT_WRONG");
  expect(f.context("run").source).toContain("LEXICAL_RIGHT");
  expect(f.context("run").source).not.toContain("OBJECT_WRONG");
});

test("object ownership preserves complete target ranges and stable unique identifiers", async () => {
  const source =
    "/** Container. */\nconst object = ({\n  nested: {\n    /** Method. */\n    run() { return 1; },\n  },\n}) satisfies object;\n";
  const adapter = new TypeScriptAdapter();
  const parsed = await adapter.parse("entry.ts", source);
  const target = parsed.targets.find((entry) => entry.name === "run");
  expect(target?.source).toBe("run() { return 1; }");
  expect(target?.line).toBe(5);
  expect(target?.endLine).toBe(5);
  expect(target?.comments).toContain("Method.");
  expect(new Set(parsed.targets.map((entry) => entry.id)).size).toBe(parsed.targets.length);
  expect((await adapter.parse("entry.ts", source)).targets).toEqual(parsed.targets);
});

test.each([
  'this["counter"] = unknownValue;',
  'this["coun\\u0074er"] = unknownValue;',
  'this["counter"] += unknownValue;',
  'this["counter"]++;',
  "({ counter: this.counter } = unknownValue);",
  '[this["counter"]] = unknownValue;',
  "({ counter: this.counter = unknownValue } = input);",
  'for (this["counter"] of input) {}',
  "this[key] = unknownValue;",
])("member mutation invalidates untyped initialisers: %s", async (mutation) => {
  const f = await analyse(
    `import { Old } from "./old"; class Owner { counter = new Old(); replace() { ${mutation} } run() { return this.counter.read(); } }`,
    { "old.ts": 'export class Old { read() { return "STALE_WRONG"; } }' },
  );
  expect(JSON.stringify(f.context("run"))).not.toContain("STALE_WRONG");
  expect(JSON.stringify(f.context("run").unresolved)).toContain("this.counter.read()");
});

test.each(["({ counter } = input);", "[counter] = input;", "[...counter] = input;", "for (counter of input) {}"])(
  "destructuring and loop writes invalidate lexical initialisers: %s",
  async (mutation) => {
    const f = await analyse(
      `import { Old } from "./old"; let counter = new Old(); ${mutation} export function run() { return counter.read(); }`,
      { "old.ts": 'export class Old { read() { return "STALE_WRONG"; } }' },
    );
    expect(JSON.stringify(f.context("run"))).not.toContain("STALE_WRONG");
    expect(JSON.stringify(f.context("run").unresolved)).toContain("counter.read()");
  },
);

test("mutation keeps declared types authoritative and ignores default expressions and computed keys", async () => {
  const f = await analyse(
    'import { Old } from "./old"; const counter = new Old(); let typed: Old; ({ [counter.read()]: assigned = counter } = input); class Owner { counter: Old = new Old(); replace() { this["counter"] = mystery; } run() { return this.counter.read() + counter.read() + typed.read(); } }',
    { "old.ts": 'export class Old { read() { return "TYPE_RIGHT"; } }' },
  );
  expect(JSON.stringify(f.context("run"))).toContain("TYPE_RIGHT");
  expect(f.context("run").unresolved).toEqual([]);
});

test.each([
  "export function run({ helper = fallback }) { return fallback(); }",
  "export function run(input) { const { helper = fallback } = input; return fallback(); }",
  "export function run({ x: helper = fallback }) { return fallback(); }",
  "export function run([helper = fallback]) { return fallback(); }",
  "export function run({ nested: { helper = fallback, ...rest }, ...other }) { return fallback(); }",
  "export function run({ [fallback()]: helper }) { return fallback(); }",
])("destructuring bindings exclude defaults and computed keys: %s", async (source) => {
  const f = await analyse(`function fallback() { return "FALLBACK_RIGHT"; } ${source}`);
  expect(f.context("run").source).toContain("FALLBACK_RIGHT");
  expect(JSON.stringify(f.context("run").unresolved)).not.toContain("fallback()");
});

test("runner names used only in defaults are not shadowed", async () => {
  const adapter = new TypeScriptAdapter([new TestRunnerConvention("@jest/globals")]);
  const source = 'function run({ helper = test }) { test("real", () => {}); }';
  expect(
    (await adapter.parse("entry.spec.ts", source)).targets.filter((target) => target.group === "tests"),
  ).toHaveLength(1);
});

test("corrected callback evidence participates in cache invalidation", async () => {
  const f = fixture();
  f.loaded.config.questions.methods = [QUESTION];
  f.write(
    "entry.ts",
    'import { helper } from "./helper"; export function run() { values.map(function helper() { return "PRIVATE"; }); return helper(); }',
  );
  f.write("helper.ts", 'export function helper() { return "FIRST"; }');
  const plan = await f.plan();
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    plan,
    new RequestBatcher().batches(plan, f.loaded.config),
  );
  f.write("helper.ts", 'export function helper() { return "SECOND"; }');
  const item = (await f.plan()).items.find((entry) => entry.target.name === "run");
  expect(JSON.stringify(item?.context)).toContain("SECOND");
  expect(item?.evaluation).toBeUndefined();
});

test.each([
  'const helper = () => "BODY_WRONG";',
  'var helper = () => "BODY_WRONG";',
  'function helper() { return "BODY_WRONG"; }',
])("parameter defaults do not see body declarations: %s", async (body) => {
  const source = `function helper() { return "OUTER_RIGHT"; } function run(value = helper()) { ${body} return value; }`;
  expect(Function(`${source}; return run();`)()).toBe("OUTER_RIGHT");
  const f = await analyse(source);
  expect(f.context("run").source).toContain('function helper() { return "OUTER_RIGHT"; }');
  expect(f.context("run").unresolved).toEqual([]);
});

test("closures created in parameter defaults keep their parameter environment", async () => {
  const f = await analyse(
    'function helper() { return "OUTER_RIGHT"; } function run(callback = function readDefault() { return helper(); }) { var helper = () => "BODY_WRONG"; return callback(); }',
  );
  expect(f.context("readDefault").source).toContain("OUTER_RIGHT");
  expect(f.context("readDefault").source).not.toContain("BODY_WRONG");
  expect(f.context("readDefault").unresolved).toEqual([]);
});

test("parameter defaults resolve earlier parameters and the body retains parameter visibility", async () => {
  const f = await analyse(
    'class Input { read() { return "PARAMETER_RIGHT"; } } class helper { static read() { return "OUTER_WRONG"; } } function run(helper: Input, value = helper.read()) { function other() { return "BODY"; } return helper.read() + value; }',
  );
  expect(f.context("run").source).toContain("PARAMETER_RIGHT");
  expect(f.context("run").source).not.toContain("OUTER_WRONG");
  expect(f.context("run").unresolved).toEqual([]);
});

test("parameter defaults retain lexical helper evidence and invalidate cached answers", async () => {
  const f = fixture();
  f.loaded.config.questions.methods = [QUESTION];
  f.write(
    "entry.ts",
    'import { helper } from "./helper"; export function run(value = helper()) { const helper = () => "BODY_WRONG"; return value; }',
  );
  f.write("helper.ts", 'export function helper() { return "FIRST"; }');
  const plan = await f.plan();
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    plan,
    new RequestBatcher().batches(plan, f.loaded.config),
  );
  f.write("helper.ts", 'export function helper() { return "SECOND"; }');
  const item = (await f.plan()).items.find((entry) => entry.target.name === "run");
  expect(JSON.stringify(item?.context)).toContain("SECOND");
  expect(item?.evaluation).toBeUndefined();
});

test.each([
  'namespace Inner { var helper = () => "NAMESPACE_WRONG"; }',
  'namespace Outer { namespace Inner { var helper = () => "NAMESPACE_WRONG"; } }',
  'module Inner { if (condition) { var helper = () => "NAMESPACE_WRONG"; } }',
  'declare module "ambient" { var helper: unknown; }',
])("namespace variables do not leak into the containing module: %s", async (namespace) => {
  const f = await analyse(
    `import { helper } from "./helper"; ${namespace} export function run() { return helper(); }`,
    { "helper.ts": 'export function helper() { return "IMPORTED_RIGHT"; }' },
  );
  expect(JSON.stringify(f.context("run").related)).toContain("IMPORTED_RIGHT");
  expect(f.context("run").source).not.toContain("NAMESPACE_WRONG");
  expect(f.context("run").unresolved).toEqual([]);
});

test("nested namespaces reserve and resolve their own var without shadowing their parent", async () => {
  const f = await analyse(
    'function helper() { return "MODULE_HELPER"; } namespace Outer { if (condition) { var helper = () => "OUTER_HELPER"; } namespace Inner { if (condition) { var helper = () => "INNER_HELPER"; } export function inner() { return helper(); } } export function outer() { return helper(); } } export function run() { return helper(); }',
  );
  expect(f.context("run").source).toContain("MODULE_HELPER");
  expect(f.context("run").source).not.toContain("OUTER_HELPER");
  expect(f.context("outer").source).toContain("OUTER_HELPER");
  expect(f.context("outer").source).not.toContain("INNER_HELPER");
  expect(f.context("inner").source).toContain("INNER_HELPER");
  expect(f.context("inner").source).not.toContain("OUTER_HELPER");
  for (const name of ["run", "outer", "inner"]) expect(f.context(name).unresolved).toEqual([]);
});

test("namespace var does not shadow runner names in the containing module", async () => {
  const adapter = new TypeScriptAdapter([new TestRunnerConvention("@jest/globals")]);
  const file = await adapter.parse(
    "entry.spec.ts",
    'test("outside", () => {}); namespace Inner { test("ordinary", () => {}); if (condition) { var test = ordinary; } }',
  );
  expect(file.targets.filter((target) => target.group === "tests").map((target) => target.name)).toEqual(["outside"]);
});

test("alias-initialised var competes with a function instead of acting as an overload signature", async () => {
  const f = await analyse(
    'import { Old, Next } from "./types"; function replacement(): Next { return new Next(); } export function run() { function helper(): Old { return new Old(); } if (condition) { var helper = replacement; } return helper().read(); }',
    {
      "types.ts":
        'export class Old { read() { return "OLD_STALE_BODY"; } } export class Next { read() { return "NEW_ACTUAL_BODY"; } }',
    },
  );
  const context = f.context("run");
  expect(JSON.stringify(context.related)).not.toContain("OLD_STALE_BODY");
  expect(context.source).toContain("var helper = replacement;");
  expect(JSON.stringify(context.unresolved)).toContain("helper().read()");
});

test("actual overload signatures retain their contracts and the implementation return type", async () => {
  const f = await analyse(
    'import { Current } from "./types"; function helper(value: string): Current; function helper(value: number): Current; function helper(value: string | number): Current { return new Current(); } export function run() { return helper(1).read(); }',
    { "types.ts": 'export class Current { read() { return "CURRENT_RIGHT"; } }' },
  );
  const context = f.context("run");
  expect(context.source).toContain("function helper(value: string): Current;");
  expect(context.source).toContain("function helper(value: number): Current;");
  expect(context.source).toContain("return new Current();");
  expect(JSON.stringify(context.related)).toContain("CURRENT_RIGHT");
  expect(context.unresolved).toEqual([]);
});
