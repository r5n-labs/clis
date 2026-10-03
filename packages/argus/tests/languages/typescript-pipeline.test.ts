import { expect, test } from "bun:test";
import { createAnalysis } from "../../src/composition/analysis";
import { parseQuestion } from "../../src/config/validation";
import { collectChanges } from "../../src/contexts/ChangeContextBuilder";
import { ContextBuilder } from "../../src/contexts/ContextBuilder";
import { reportData } from "../../src/reports/report-data";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fixture, response } from "../helpers";

const QUESTION = parseQuestion({
  id: "implementation",
  type: "choice",
  context: "references",
  instructions: "Check the implementation",
  criteria: { yes: "Correct", no: "Incorrect" },
  include: ["entry.ts"],
});

function commitFixture(root: string): void {
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode) throw new Error(result.stderr.toString());
  };
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
}

test("production TypeScript keeps baseline and working-tree dependencies isolated", async () => {
  const f = fixture();
  f.write("entry.ts", 'import { price } from "./price"; export function total() { return price(); }');
  f.write("price.ts", "export function price() { return 10; }");
  commitFixture(f.loaded.root);
  f.write("entry.ts", 'import { price } from "./price"; export function total() { return price() * 2; }');
  f.write("price.ts", "export function price() { return 20; }");
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
  const changes = await collectChanges(f.loaded, project);
  const target = changes.find((entry) => entry.path === "entry.ts");
  const question = f.loaded.config.questions.methods[0];
  if (!target || !question) throw new Error("Missing fixture target or question");
  const context = new ContextBuilder(project).build(target, { ...question, context: "references" });
  expect(context.related.find((entry) => entry.path === "before:price.ts")?.source).toContain("return 10");
  expect(context.related.find((entry) => entry.path === "after:price.ts")?.source).toContain("return 20");
});

test.each([
  ["1", "2", []],
  ["Map", "Set", []],
  ["NaN", "Infinity", []],
  ["base", "base + 1", ["const base = 7;"]],
  ["base + 1", "base + 2", ["const base = 7;"]],
  ["[base]", "[base, base]", ["const base = 7;"]],
  ["factory(input)", "factory(input + 1)", ["const input = 7;", "function factory(value: number) { return value; }"]],
] as const)(
  "default export expressions retain source, dependencies and cache identity: %s",
  async (before, after, declarations) => {
    const f = fixture();
    f.loaded.config.questions.methods = [QUESTION];
    f.write("entry.ts", 'import value from "./value"; export function run() { return value; }');
    const source = `${declarations.join("\n")}\nexport default ${before};\nfunction unused() { return "UNUSED_SIBLING"; }`;
    f.write("value.ts", source);
    const first = await f.plan();
    const item = first.items.find((entry) => entry.target.name === "run");
    const evidence = item?.context.related.find((entry) => entry.path === "value.ts")?.source;
    expect(evidence).toContain(`export default ${before};`);
    for (const declaration of declarations) expect(evidence).toContain(declaration);
    expect(evidence).not.toContain("UNUSED_SIBLING");
    await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
      first,
      new RequestBatcher().batches(first, f.loaded.config),
    );
    expect((await f.plan()).items.find((entry) => entry.target.name === "run")?.evaluation).toBeDefined();
    f.write("value.ts", source.replace(`export default ${before};`, `export default ${after};`));
    const changed = (await f.plan()).items.find((entry) => entry.target.name === "run");
    expect(changed?.context.related.find((entry) => entry.path === "value.ts")?.source).toContain(
      `export default ${after};`,
    );
    expect(changed?.inputHash).not.toBe(item?.inputHash);
    expect(changed?.evaluation).toBeUndefined();
  },
);

test("top-level calls supply file and change dependencies without broadening unrelated method evidence", async () => {
  const f = fixture();
  f.loaded.config.questions.files = [QUESTION];
  f.loaded.config.questions.methods = [QUESTION];
  const source = 'import { setup } from "./setup"; setup(1); export function untouched() { return "UNCHANGED"; }';
  f.write("entry.ts", source);
  f.write("setup.ts", 'export function setup(value: number) { return "BEFORE" + value; }');
  commitFixture(f.loaded.root);
  const first = await f.plan();
  const file = first.items.find((entry) => entry.target.group === "files");
  expect(file?.context.related.find((entry) => entry.path === "setup.ts")?.source).toContain("BEFORE");
  const method = first.items.find((entry) => entry.target.name === "untouched");
  expect(method?.context.related).toEqual([]);
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    first,
    new RequestBatcher().batches(first, f.loaded.config),
  );
  f.write("setup.ts", 'export function setup(value: number) { return "AFTER" + value; }');
  const changed = await f.plan();
  const changedFile = changed.items.find((entry) => entry.target.group === "files");
  expect(changedFile?.context.related.find((entry) => entry.path === "setup.ts")?.source).toContain("AFTER");
  expect(changedFile?.inputHash).not.toBe(file?.inputHash);
  expect(changedFile?.evaluation).toBeUndefined();
  expect(changed.items.find((entry) => entry.target.name === "untouched")?.evaluation).toBeDefined();
  f.write("entry.ts", source.replace("setup(1)", "setup(2)"));
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
  const target = (await collectChanges(f.loaded, project)).find((entry) => entry.path === "entry.ts");
  if (!target) throw new Error("Missing entry change");
  const context = new ContextBuilder(project).build(target, QUESTION);
  expect(context.related.find((entry) => entry.path === "before:setup.ts")?.source).toContain("BEFORE");
  expect(context.related.find((entry) => entry.path === "after:setup.ts")?.source).toContain("AFTER");
});

test("TypeScript report evidence is exactly the evaluated context and respects excluded dependencies", async () => {
  const f = fixture();
  const question = f.loaded.config.questions.methods[0];
  if (!question) throw new Error("Missing question");
  question.context = "references";
  f.loaded.config.exclude.push("hidden/**");
  f.write(
    "entry.ts",
    'import { price } from "./price"; import { secret } from "./hidden/secret"; export function total() { return price() + secret(); }',
  );
  f.write("price/index.ts", "export function price() { return 10; }");
  f.write("hidden/secret.ts", "export function secret() { return 'EXCLUDED_EVIDENCE'; }");
  const plan = await f.plan();
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    plan,
    new RequestBatcher().batches(plan, f.loaded.config),
  );
  const checked = await f.plan();
  expect(new RequestBatcher().batches(checked, f.loaded.config)).toHaveLength(0);
  const item = checked.items.find((entry) => entry.target.name === "total");
  expect(item?.context.language).toBe("TypeScript");
  expect(
    item?.context.related.some((entry) => entry.path === "price/index.ts" && entry.source.includes("return 10")),
  ).toBe(true);
  expect(JSON.stringify(item?.context.unresolved)).toContain("secret()");
  const report = reportData(checked, 0);
  expect(Object.values(report.contexts)).toContainEqual(item?.context);
  expect(JSON.stringify(report.contexts)).not.toContain("EXCLUDED_EVIDENCE");
  expect(JSON.stringify(item?.context)).not.toMatch(/Godot|GDScript|res:\/\//);
});
