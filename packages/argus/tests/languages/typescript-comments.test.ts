import { expect, test } from "bun:test";
import { createAnalysis } from "../../src/composition/analysis";
import { parseQuestion } from "../../src/config/validation";
import { ContextBuilder } from "../../src/contexts/ContextBuilder";
import type { ContextMode } from "../../src/domain/question";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewPlanner } from "../../src/services/ReviewPlanner";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { inputFingerprint } from "../../src/storage/fingerprints";
import { fixture, response } from "../helpers";

const QUESTION = parseQuestion({
  id: "comments",
  type: "choice",
  context: "references",
  instructions: "Check comments",
  criteria: { yes: "Accurate", no: "Inaccurate" },
});
const MODES: ContextMode[] = ["target", "class", "references", "file"];

async function analysed(source: string, path = "entry.ts", dependencies: Record<string, string> = {}) {
  const f = fixture();
  f.write(path, source);
  for (const [name, text] of Object.entries(dependencies)) f.write(name, text);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const target = (name: string) => {
    const found = project.targets.find((entry) => entry.name === name && entry.group === "methods");
    if (!found) throw new Error(`Missing target ${name}`);
    return found;
  };
  const context = (name: string, mode: ContextMode = "references") =>
    new ContextBuilder(project).build(target(name), { ...QUESTION, context: mode });
  return { ...f, project, target, context };
}

test.each([
  ["plain.ts", "const ten=10; // TEN_ONLY\nfunction two(){return 2;}"],
  ["export.ts", "export const ten=10; // TEN_ONLY\nexport function two(){return 2;}"],
  ["object.ts", "const object={one(){return 1;}, // TEN_ONLY\ntwo(){return 2;}};"],
  ["class.ts", "class C { one(){return 1;}; // TEN_ONLY\ntwo(){return 2;} }"],
  ["view.tsx", "const ten=<div/>; // TEN_ONLY\nexport function two(){return <span/>;}"],
  ["block.ts", "const ten=10; /* TEN_ONLY */\nfunction two(){return 2;}"],
])("preceding trailing comments do not belong to the following declaration in %s", async (path, source) => {
  if (!path || !source) throw new Error("Missing fixture");
  const f = await analysed(source, path);
  expect(f.target("two").comments).not.toContain("TEN_ONLY");
  expect(f.target("two").leadingComments).toBe("");
  for (const mode of MODES.filter((mode) => mode !== "file"))
    expect(f.context("two", mode).source).not.toContain("TEN_ONLY");
  expect(f.context("two", "file").source).toBe(source);
});

test.each(["ts", "tsx"])(
  "mixed trailing and real leading documentation preserves only the latter in %s",
  async (extension) => {
    const f = await analysed(
      "const ten=10; // TEN_ONLY\n/** TWO_OWN */\n// TWO_DETAIL\nexport function two(){return 2;}",
      `entry.${extension}`,
    );
    expect(f.target("two").leadingComments).toBe("/** TWO_OWN */\n// TWO_DETAIL");
    expect(f.target("two").comments).not.toContain("TEN_ONLY");
    for (const mode of MODES.filter((mode) => mode !== "file")) {
      const source = f.context("two", mode).source;
      expect(source).toContain("TWO_OWN");
      expect(source).toContain("TWO_DETAIL");
      expect(source).not.toContain("TEN_ONLY");
    }
  },
);

test.each([
  "const ten=10; /** TWO_OWN */ function two(){return 2;}",
  "const object={one(){return 1;}, /** TWO_OWN */ two(){return 2;}};",
  "class Owner { one(){return 1;}; /** TWO_OWN */ two(){return 2;} }",
])("inline JSDoc remains attached to the following declaration: %s", async (source) => {
  const f = await analysed(source);
  expect(f.target("two").leadingComments).toBe("/** TWO_OWN */");
  expect(f.context("two", "target").source).toBe(["/** TWO_OWN */", f.target("two").source].join("\n"));
});

test.each(["ts", "tsx"])(
  "selected declarations retain their own trailing comments verbatim in %s",
  async (extension) => {
    const constant = "export const marker = 2; // MARKER_WEIGHT";
    const fn = "export function two(){return marker;} /* FUNCTION_TRAILING */";
    const f = await analysed('import { two } from "./dependency"; export function run(){return two();}', "entry.ts", {
      [`dependency.${extension}`]: `const ten=10; // TEN_ONLY\n${constant}\n${fn}\nexport function unused(){return 0;}`,
    });
    const source = f.context("run").related.find((entry) => entry.path === `dependency.${extension}`)?.source;
    expect(source).toContain(constant);
    expect(source).toContain(fn);
    expect(source).not.toContain("TEN_ONLY");
    expect(source?.match(/MARKER_WEIGHT/g)).toHaveLength(1);
    expect(source?.match(/FUNCTION_TRAILING/g)).toHaveLength(1);
  },
);

test.each([
  ["const object={one(){return 1;}, // ONE_ONLY\ntwo(){return 2;}};", "one(){return 1;}, // ONE_ONLY"],
  ["function one() {}; // ONE_ONLY\nfunction two() {}", "function one() {}; // ONE_ONLY"],
  ["class C { one(){return 1;}; // ONE_ONLY\ntwo(){return 2;} }", "one(){return 1;}; // ONE_ONLY"],
])("trailing comments retain separators and exact target ranges: %s", async (source, expected) => {
  if (!source || !expected) throw new Error("Missing fixture");
  const f = await analysed(source);
  const target = f.target("one");
  expect(target.source).toBe(expected);
  expect(target.comments).toContain("ONE_ONLY");
  expect(target.leadingComments).toBe("");
  expect(target.line).toBe(1);
  expect(target.endLine).toBe(1);
});

test.each(MODES)("nested comments remain once in their original body in %s mode", async (mode) => {
  const source = "export function factory(){ return { regular(){return 2;}, /** ONE_ONLY */ one(){return 1;} }; }";
  const f = await analysed(source);
  expect(f.target("factory").comments).toContain("ONE_ONLY");
  expect(f.target("factory").leadingComments).toBe("");
  expect(f.context("factory", mode).source).toBe(source);
});

test("multiline trailing comments preserve exact Unicode and CRLF source boundaries", async () => {
  const own = 'export function first(){return "żółw";} /* FIRST\r\ncontinues */';
  const source = `${own}\r\n/** SECOND */\r\nexport function second(){return 2;}`;
  const f = await analysed(source);
  expect(f.target("first").source).toBe(own);
  expect(f.target("first").line).toBe(1);
  expect(f.target("first").endLine).toBe(2);
  expect(f.target("second").leadingComments).toBe("/** SECOND */");
  expect(f.target("second").comments).not.toContain("FIRST");
  expect(f.context("first", "file").source).toBe(source);
});

test.each([
  "export function factory(){ /** NESTED_ONLY */ function nested(){return 1;} return nested(); }",
  "export function factory(){ return { regular(){return 2;}, /** NESTED_ONLY */ one(){return 1;} }; }",
  "export function factory(){ return class Inner { /** NESTED_ONLY */ one(){return 1;} }; }",
])("selected factory dependencies keep nested comments in their original body: %s", async (factory) => {
  const f = await analysed(
    'import { factory } from "./factory"; export function run(){return factory();}',
    "entry.ts",
    { "factory.tsx": factory },
  );
  const source = f.context("run").related.find((entry) => entry.path === "factory.tsx")?.source;
  expect(source).toBe(factory);
  expect(source?.match(/NESTED_ONLY/g)).toHaveLength(1);
});

test("own leading method documentation remains distinct from class-owner documentation", async () => {
  const f = await analysed(
    "/** CLASS_OWN */\nexport class Owner { /** METHOD_OWN */ run(){ /* BODY_ONLY */ return 1;} /** OTHER_ONLY */ other(){return 2;} }",
  );
  expect(f.target("run").documentation).toBe("/** CLASS_OWN */");
  expect(f.target("run").leadingComments).toBe("/** METHOD_OWN */");
  for (const mode of MODES.filter((mode) => mode !== "file")) {
    const source = f.context("run", mode).source;
    expect(source).toContain("CLASS_OWN");
    expect(source).toContain("METHOD_OWN");
    expect(source).not.toContain("OTHER_ONLY");
    expect(source.match(/BODY_ONLY/g)).toHaveLength(1);
  }
});

test("hasComments eligibility includes body and trailing comments but excludes a predecessor's comment", async () => {
  const f = await analysed(
    "const ten=10; // PREDECESSOR_ONLY\nexport function clean(){return 2;}\nexport function body(){ /* BODY_ONLY */ return 2;}\nexport function trailing(){return 2;} // TRAILING_ONLY",
  );
  f.loaded.config.questions.methods = [{ ...QUESTION, hasComments: true }];
  const plan = new ReviewPlanner(f.store).plan(f.project, f.loaded.config);
  expect(plan.items.filter((item) => item.target.group === "methods").map((item) => item.target.name)).toEqual([
    "body",
    "trailing",
  ]);
});

test("generic adapters without explicit leading comments retain their existing target rendering", async () => {
  const f = await analysed("# LEADING_GD\nfunc run():\n    return 1\n", "entry.gd");
  const target = f.target("run");
  expect(target.leadingComments).toBeUndefined();
  expect(f.context("run", "target").source).toBe(
    [target.documentation, target.comments, target.source].filter(Boolean).join("\n"),
  );
  expect(f.context("run", "target").source).toContain("LEADING_GD");
});

test("corrected owned comments change context hashes while unrelated comments preserve cached answers", async () => {
  const f = fixture();
  f.loaded.config.questions.methods = [{ ...QUESTION, context: "target" }];
  const source =
    "const ten=10; // PREDECESSOR_ONLY\n/** RUN_OWN */\nexport function run(){ /* BODY_ONLY */ return 2;}\nexport function unrelated(){return 1;} // OTHER_ONLY";
  f.write("entry.ts", source);
  const first = await f.plan();
  const item = first.items.find((entry) => entry.target.name === "run");
  if (!item) throw new Error("Missing run");
  const previousContext = {
    ...item.context,
    source: ["// PREDECESSOR_ONLY", "/** RUN_OWN */", "/* BODY_ONLY */", item.target.source].join("\n"),
  };
  expect(item.inputHash).not.toBe(inputFingerprint(f.loaded.root, item.target, previousContext));
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    first,
    new RequestBatcher().batches(first, f.loaded.config),
  );
  f.write("entry.ts", source.replace("PREDECESSOR_ONLY", "PREDECESSOR_EDITED").replace("OTHER_ONLY", "OTHER_EDITED"));
  const unchanged = (await f.plan()).items.find((entry) => entry.target.name === "run");
  expect(unchanged?.inputHash).toBe(item.inputHash);
  expect(unchanged?.evaluation).toBeDefined();
  f.write("entry.ts", source.replace("BODY_ONLY", "BODY_EDITED"));
  const changed = (await f.plan()).items.find((entry) => entry.target.name === "run");
  expect(changed?.inputHash).not.toBe(item.inputHash);
  expect(changed?.evaluation).toBeUndefined();
});

test("selected dependency trailing-comment edits invalidate the caller's cached answer", async () => {
  const f = fixture();
  f.loaded.config.questions.methods = [QUESTION];
  f.write("entry.ts", 'import { value } from "./dependency"; export function run(){return value;}');
  f.write("dependency.ts", "export const value=2; // FIRST_TRAILING");
  const first = await f.plan();
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    first,
    new RequestBatcher().batches(first, f.loaded.config),
  );
  f.write("dependency.ts", "export const value=2; // SECOND_TRAILING");
  const changed = (await f.plan()).items.find((entry) => entry.target.name === "run");
  expect(JSON.stringify(changed?.context)).toContain("SECOND_TRAILING");
  expect(changed?.evaluation).toBeUndefined();
});
