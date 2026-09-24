import { expect, test } from "bun:test";
import { createAnalysis } from "../../src/composition/analysis";
import { collectChanges } from "../../src/contexts/ChangeContextBuilder";
import { ContextBuilder } from "../../src/contexts/ContextBuilder";
import { reportData } from "../../src/reports/report-data";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fixture, response } from "../helpers";

test("production TypeScript keeps baseline and working-tree dependencies isolated", async () => {
  const f = fixture();
  f.write("entry.ts", 'import { price } from "./price"; export function total() { return price(); }');
  f.write("price.ts", "export function price() { return 10; }");
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: f.loaded.root, stdout: "pipe", stderr: "pipe" });
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
  f.write("entry.ts", 'import { price } from "./price"; export function total() { return price() * 2; }');
  f.write("price.ts", "export function price() { return 20; }");
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const changes = await collectChanges(f.loaded, project, "HEAD");
  const target = changes.find((entry) => entry.path === "entry.ts");
  const question = f.loaded.config.questions.methods[0];
  if (!target || !question) throw new Error("Missing fixture target or question");
  const context = new ContextBuilder(project).build(target, { ...question, context: "references" });
  expect(context.related.find((entry) => entry.path === "before:price.ts")?.source).toContain("return 10");
  expect(context.related.find((entry) => entry.path === "after:price.ts")?.source).toContain("return 20");
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
