import { expect, test } from "bun:test";
import { AnalysisRegistry } from "../../src/analysis/AnalysisRegistry";
import type { TargetContextPolicy } from "../../src/analysis/contracts";
import { parseQuestion } from "../../src/config/validation";
import { collectChanges } from "../../src/contexts/ChangeContextBuilder";
import { ContextBuilder } from "../../src/contexts/ContextBuilder";
import { GettextAdapter } from "../../src/formats/gettext/GettextAdapter";
import { TextAdapter } from "../../src/formats/TextAdapter";
import { reportData } from "../../src/reports/report-data";
import { TranslationEvidence } from "../../src/reviews/translations/TranslationEvidence";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewPlanner } from "../../src/services/ReviewPlanner";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fixture, response } from "../helpers";
import {
  CatalogueFixtureAdapter,
  FIXTURE_CONFIG,
  FixtureFramework,
  TypeScriptFixtureAdapter,
} from "./fixture-adapters";

function analysis() {
  return new AnalysisRegistry({
    adapters: [new TypeScriptFixtureAdapter(), new CatalogueFixtureAdapter(), new GettextAdapter()],
    fallback: new TextAdapter(),
    frameworks: [new FixtureFramework()],
    policies: [],
    reviews: [new TranslationEvidence()],
  });
}

test("a non-Godot adapter runs through scanning, reference context, caching and report evidence", async () => {
  const f = fixture();
  f.loaded.config.include = ["**/*.ts"];
  const question = f.loaded.config.questions.methods[0];
  if (!question) throw new Error("Missing question");
  question.context = "references";
  f.write("entry.ts", 'import { price } from "./price.ts";\nexport function total() { return price(); }');
  f.write("price.ts", "export function price() { return 10; }");
  const scanner = new ProjectScanner(analysis());
  const plan = async () => new ReviewPlanner(f.store).plan(await scanner.scan(f.loaded), f.loaded.config);
  const before = await plan();
  const item = before.items.find((entry) => entry.target.name === "total");
  expect(item?.context.language).toBe("TypeScript fixture");
  expect(item?.context.related).toEqual([{ path: "price.ts", source: "export function price() { return 10; }" }]);
  expect(JSON.stringify(item?.context)).not.toMatch(/Godot|res:\/\/|GDScript/);
  const runner = new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) });
  const batcher = new RequestBatcher();
  await runner.run(before, batcher.batches(before, f.loaded.config));
  expect(batcher.batches(await plan(), f.loaded.config)).toHaveLength(0);
  const report = reportData(await plan(), 0);
  expect(Object.values(report.contexts).some((context) => context.source.includes("return price()"))).toBe(true);
  f.write("price.ts", "export function price() { return 20; }");
  expect((await plan()).items.filter((entry) => !entry.evaluation)).toHaveLength(2);
});

test("translation review consumes semantic identities and usages across independent formats and languages", async () => {
  const f = fixture();
  f.loaded.config.include = ["**/*.ts", "**/*.po", "**/*.catalogue"];
  f.loaded.config.questions.translations = [
    parseQuestion({
      id: "translation",
      type: "choice",
      instructions: "Check text",
      context: "target",
      criteria: { yes: "Correct", no: "Wrong" },
    }),
  ];
  f.write("source.po", 'msgid "screen.title"\nmsgstr "Screen title"\n');
  f.write("target.catalogue", "screen.title = Translated title");
  f.write("screen.ts", 'export function title() { return translate("screen.title"); }');
  const project = await new ProjectScanner(analysis()).scan(f.loaded);
  const plan = new ReviewPlanner(f.store).plan(project, f.loaded.config);
  const context = plan.items.find((item) => item.target.path === "target.catalogue")?.context;
  expect(context?.language).toBe("Fixture catalogue");
  expect(context?.related.some((entry) => entry.path === "source.po" && entry.source.includes("Screen title"))).toBe(
    true,
  );
  expect(context?.related.some((entry) => entry.path === "screen.ts" && entry.source.includes("translate"))).toBe(true);
});

test("Git baselines use the registered adapter and preserve independent dependency versions", async () => {
  const f = fixture();
  f.loaded.config.include = ["**/*.ts"];
  f.write(FIXTURE_CONFIG, "mode=baseline");
  f.write("entry.ts", 'import { price } from "./price.ts";\nexport function total() { return price(); }');
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
  f.write("entry.ts", 'import { price } from "./price.ts";\nexport function total() { return price() * 2; }');
  f.write("price.ts", "export function price() { return 20; }");
  f.write(FIXTURE_CONFIG, "mode=current");
  const project = await new ProjectScanner(analysis()).scan(f.loaded);
  const changes = await collectChanges(f.loaded, project, "HEAD");
  const entry = changes.find((target) => target.path === "entry.ts");
  const question = f.loaded.config.questions.methods[0];
  if (!entry || !question) throw new Error("Missing fixture");
  const context = new ContextBuilder(project).build(entry, { ...question, context: "references" });
  expect(context.related.find((source) => source.path === "before:price.ts")?.source).toContain("return 10;");
  expect(context.related.find((source) => source.path === "after:price.ts")?.source).toContain("return 20;");
  expect(context.related.find((source) => source.path === `before:${FIXTURE_CONFIG}`)?.source).toContain(
    "mode=baseline",
  );
  expect(context.related.find((source) => source.path === `after:${FIXTURE_CONFIG}`)?.source).toContain("mode=current");
  expect(project.files.has(FIXTURE_CONFIG)).toBe(false);
});

test("framework configuration discovery respects exclusions", async () => {
  const f = fixture();
  f.loaded.config.include = ["**/*.ts"];
  f.loaded.config.exclude.push(FIXTURE_CONFIG);
  f.write(FIXTURE_CONFIG, "mode=hidden");
  f.write("entry.ts", "export function entry() {}");
  const project = await new ProjectScanner(analysis()).scan(f.loaded);
  expect(project.configuration.has(FIXTURE_CONFIG)).toBe(false);
});

test("registries reject duplicate identities, ambiguous ownership and inconsistent adapter output", async () => {
  const registration = { fallback: new TextAdapter(), frameworks: [], reviews: [], policies: [] };
  expect(
    () =>
      new AnalysisRegistry({
        ...registration,
        adapters: [new TypeScriptFixtureAdapter(), new TypeScriptFixtureAdapter()],
      }),
  ).toThrow("Duplicate");
  class OverlappingAdapter extends TextAdapter {
    override readonly id = "overlap";
  }
  const overlap = new AnalysisRegistry({
    ...registration,
    adapters: [new TypeScriptFixtureAdapter(), new OverlappingAdapter()],
  });
  await expect(overlap.parse("entry.ts", "export function entry() {} ")).rejects.toThrow("Multiple source adapters");
  class InvalidAdapter extends TypeScriptFixtureAdapter {
    override async parse(path: string, source: string) {
      return { ...(await super.parse(path, source)), adapterId: "wrong" };
    }
  }
  const invalid = new AnalysisRegistry({ ...registration, adapters: [new InvalidAdapter()] });
  await expect(invalid.parse("entry.ts", "export function entry() {} ")).rejects.toThrow("inconsistent file identity");
});

test("primary-context policies cannot conflict or change target identity", async () => {
  const f = fixture();
  f.loaded.config.include = ["**/*.ts"];
  f.write("entry.ts", "export function entry() {}");
  const project = await new ProjectScanner(analysis()).scan(f.loaded);
  const target = project.targets[0];
  if (!target) throw new Error("Missing fixture target");
  const policy: TargetContextPolicy = {
    supports: () => true,
    prepare: (_project, entry) => ({ target: entry, notes: [] }),
  };
  const registration = {
    adapters: [new TypeScriptFixtureAdapter()],
    fallback: new TextAdapter(),
    frameworks: [],
    reviews: [],
  };
  const conflicting = new AnalysisRegistry({ ...registration, policies: [policy, policy] });
  expect(() => conflicting.prepareTarget(project, target, "class", 1000)).toThrow("Multiple context policies");
  const invalid = new AnalysisRegistry({
    ...registration,
    policies: [{ ...policy, prepare: (_project, entry) => ({ target: { ...entry, id: "different" }, notes: [] }) }],
  });
  expect(() => invalid.prepareTarget(project, target, "class", 1000)).toThrow("changed target identity");
});
