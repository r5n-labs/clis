import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAnalysis } from "../../src/composition/analysis";
import { ConfigEditor } from "../../src/config/ConfigEditor";
import { loadConfig } from "../../src/config/loader";
import { parseConfig } from "../../src/config/validation";
import { presetQuestions } from "../../src/presets";
import previousArchitecture from "../../src/presets/architecture-v1.json";
import previousTranslations from "../../src/presets/translations-v1.json";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewPlanner } from "../../src/services/ReviewPlanner";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { questionFingerprint } from "../../src/storage/fingerprints";
import { cli, fixture, response } from "../helpers";

async function configuredFixture() {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  return {
    ...f,
    command: (...args: string[]) => cli(f.loaded.root, ["config", ...args, "--config", f.loaded.path]),
    source: () => readFileSync(f.loaded.path, "utf8"),
    config: () => loadConfig(f.loaded.path).config,
    jsonFile(name: string, value: unknown) {
      const path = join(f.directory, name);
      writeFileSync(path, JSON.stringify(value));
      return path;
    },
  };
}

test("config show discovers config upwards and never rewrites it", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init"])).code).toBe(0);
  const path = join(f.loaded.root, ".argus/config.json");
  const original = readFileSync(path, "utf8");
  const nested = join(f.loaded.root, "nested");
  mkdirSync(nested);
  const result = await cli(nested, ["config", "show"]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).questions.methods[0].id).toBe("naming-accuracy");
  expect(readFileSync(path, "utf8")).toBe(original);
  expect((await cli(nested, ["config", "set", "maxQuestions", "16"])).code).toBe(0);
  expect(loadConfig(path).config.maxQuestions).toBe(16);
});

test("preset additions are idempotent and preserve settings, schema and the existing naming question", async () => {
  const f = await configuredFixture();
  const document = { ...JSON.parse(f.source()), $schema: "./schema.json", maxQuestions: 7 };
  writeFileSync(f.loaded.path, JSON.stringify(document));
  expect((await f.command("preset", "add", "comments", "architecture")).code).toBe(0);
  expect(f.config().questions.methods.map((q) => q.id)).toEqual(["naming-accuracy", "comment-accuracy"]);
  expect(f.config().questions.classes.map((q) => q.id)).toEqual(["architecture-ownership"]);
  expect(f.config().maxQuestions).toBe(7);
  expect(JSON.parse(f.source()).$schema).toBe("./schema.json");
  const original = f.source();
  expect((await f.command("preset", "add", "comments", "naming", "architecture")).code).toBe(0);
  expect(f.source()).toBe(original);
  const all = await f.command("preset", "add", "all");
  expect(all.code).toBe(0);
  expect(all.stdout).toContain("--base");
  expect(Object.values(f.config().questions).flat()).toHaveLength(9);
});

test("preset conflicts and unknown presets leave the entire configuration unchanged", async () => {
  const f = await configuredFixture();
  const file = f.jsonFile("edit.json", { instructions: "My naming rubric" });
  expect((await f.command("question", "edit", "methods", "naming-accuracy", "--file", file)).code).toBe(0);
  const original = f.source();
  const conflict = await f.command("preset", "add", "comments", "naming");
  expect(conflict.code).toBe(1);
  expect(conflict.stdout + conflict.stderr).toContain("customised question");
  expect(f.source()).toBe(original);
  expect((await f.command("preset", "add", "comments", "typo")).code).toBe(1);
  expect(f.source()).toBe(original);
});

test("questions can be added, patched, renamed and removed without losing other fields", async () => {
  const f = await configuredFixture();
  const question = {
    id: "mutation",
    type: "choice",
    instructions: "Does this mutate state?",
    criteria: { yes: "Mutates", no: "Read only" },
    flag: ["yes"],
  };
  const file = f.jsonFile("question.json", question);
  expect((await f.command("question", "add", "methods", "--file", file)).code).toBe(0);
  const added = f.source();
  expect((await f.command("question", "add", "methods", "--file", file)).code).toBe(1);
  expect(f.source()).toBe(added);
  const patch = f.jsonFile("patch.json", { id: "side-effects", minConfidence: 0.8 });
  expect((await f.command("question", "edit", "methods", "mutation", "--file", patch)).code).toBe(0);
  expect(f.config().questions.methods.find((q) => q.id === "side-effects")).toMatchObject({
    ...question,
    id: "side-effects",
    minConfidence: 0.8,
  });
  const invalid = f.jsonFile("invalid.json", { id: "naming-accuracy" });
  const edited = f.source();
  expect((await f.command("question", "edit", "methods", "side-effects", "--file", invalid)).code).toBe(1);
  expect(f.source()).toBe(edited);
  expect((await f.command("question", "remove", "methods", "side-effects")).code).toBe(0);
  expect(f.config().questions.methods.map((q) => q.id)).toEqual(["naming-accuracy"]);
  expect((await f.command("question", "remove", "methods", "absent")).code).toBe(1);
});

test("settings accept strings, positive integers and JSON glob lists", async () => {
  const f = await configuredFixture();
  for (const [key, input, expected] of [
    ["model", "jev-custom", "jev-custom"],
    ["maxRequestBytes", "2048", 2048],
    ["include", '["**/{one,two}.gd"]', ["**/{one,two}.gd"]],
    ["exclude", "[]", []],
    ["root", "../project", "../project"],
  ] as const) {
    expect((await f.command("set", key, input)).code).toBe(0);
    expect(f.config()[key]).toEqual(expected);
  }
});

test.each([
  ["set", "maxQuestions", "0"],
  ["set", "maxQuestions", "1.5"],
  ["set", "maxQuestions", "NaN"],
  ["set", "include", "not-json"],
  ["set", "exclude", "[1]"],
  ["set", "root", "missing"],
  ["set", "version", "2"],
  ["set", "maxQuestions", "16", "unexpected"],
  ["set", "maxQuestions", "16", "--typo"],
  ["question", "remove", "invalid", "naming-accuracy"],
  ["question", "remove", "methods", "naming-accuracy", "unexpected"],
  ["question", "add", "methods", "--file"],
])("invalid config command leaves the file unchanged: %j", async (...args) => {
  const f = await configuredFixture();
  const original = f.source();
  expect((await f.command(...args)).code).toBe(1);
  expect(f.source()).toBe(original);
  expect(readdirSync(f.loaded.stateDir)).toEqual(["config.json"]);
});

test.each([
  [],
  ["preset", "add"],
  ["question", "add", "methods"],
  ["question", "edit", "methods", "naming-accuracy"],
  ["question", "remove"],
  ["set"],
])("prompts fail clearly without a terminal: %j", async (...args) => {
  const f = await configuredFixture();
  const original = f.source();
  const result = await f.command(...args);
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).toContain("requires a terminal");
  expect(f.source()).toBe(original);
});

test("configuration edits preserve cached naming answers and schedule only added or changed questions", async () => {
  const f = await configuredFixture();
  f.write("example.gd", "## Return one.\nfunc value():\n    return 1\n");
  const plan = async () => {
    const loaded = loadConfig(f.loaded.path);
    return new ReviewPlanner(f.store).plan(await new ProjectScanner(createAnalysis()).scan(loaded), loaded.config);
  };
  const first = await plan();
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(first, new RequestBatcher().batches(first, f.loaded.config));
  const cacheFiles = readdirSync(f.store.directory, { recursive: true });
  expect((await f.command("preset", "add", "comments")).code).toBe(0);
  const added = await plan();
  expect(added.items.filter((item) => item.evaluation).map((item) => item.question.id)).toEqual(["naming-accuracy"]);
  expect(added.items.filter((item) => !item.evaluation).map((item) => item.question.id)).toEqual(["comment-accuracy"]);
  const threshold = f.jsonFile("threshold.json", { minConfidence: 0.95 });
  expect((await f.command("question", "edit", "methods", "naming-accuracy", "--file", threshold)).code).toBe(0);
  expect((await plan()).items.filter((item) => item.evaluation)).toHaveLength(1);
  const rubric = f.jsonFile("rubric.json", { instructions: "A different rubric" });
  expect((await f.command("question", "edit", "methods", "naming-accuracy", "--file", rubric)).code).toBe(0);
  expect((await plan()).items.every((item) => !item.evaluation)).toBe(true);
  expect(readdirSync(f.store.directory, { recursive: true })).toEqual(cacheFiles);
});

test("stale editors refuse to overwrite newer edits and expose independent config copies", async () => {
  const f = await configuredFixture();
  const first = new ConfigEditor(f.loaded.path);
  const stale = new ConfigEditor(f.loaded.path);
  first.config.questions.methods.length = 0;
  expect(first.config.questions.methods).toHaveLength(1);
  first.set("maxQuestions", 16);
  expect(() => stale.set("maxQuestions", 8)).toThrow("changed while editing");
  expect(f.config().maxQuestions).toBe(16);
  expect(existsSync(f.store.directory)).toBe(false);
  expect(readdirSync(f.loaded.stateDir)).toEqual(["config.json"]);
});

test("complete question edits can disable the optional concern threshold", () => {
  const f = fixture();
  const question = f.loaded.config.questions.methods[0];
  if (!question) throw new Error("fixture question");
  question.minConcernProbability = 0.6;
  mkdirSync(f.loaded.stateDir, { recursive: true });
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const editor = new ConfigEditor(f.loaded.path);
  const edited = structuredClone(editor.question("methods", question.id));
  delete edited.minConcernProbability;
  editor.replaceQuestion("methods", question.id, edited);
  expect(editor.question("methods", question.id).minConcernProbability).toBeUndefined();
});

test("question patches retain omitted thresholds and explicitly remove them with null", async () => {
  const f = await configuredFixture();
  const editor = new ConfigEditor(f.loaded.path);
  editor.editQuestion("methods", "naming-accuracy", { minConcernProbability: 0.6 });
  editor.editQuestion("methods", "naming-accuracy", { minConfidence: 0.8 });
  expect(editor.question("methods", "naming-accuracy").minConcernProbability).toBe(0.6);
  const patch = f.jsonFile("disable.json", { minConcernProbability: null });
  expect((await f.command("question", "edit", "methods", "naming-accuracy", "--file", patch)).code).toBe(0);
  expect(f.config().questions.methods[0]?.minConcernProbability).toBeUndefined();
  expect(f.config().questions.methods[0]?.minConfidence).toBe(0.8);
  const source = f.source();
  const invalid = f.jsonFile("invalid.json", { instructions: null });
  expect((await f.command("question", "edit", "methods", "naming-accuracy", "--file", invalid)).code).toBe(1);
  expect(f.source()).toBe(source);
});

test.each([
  ["architecture", "classes", previousArchitecture],
  ["translations", "translations", previousTranslations],
] as const)("stock %s rubrics upgrade without overwriting customised questions", (preset, group, previous) => {
  const f = fixture();
  const config = { ...f.loaded.config, questions: { [group]: [{ ...previous, minConfidence: 0.8 }] } };
  const upgraded = parseConfig(config).questions[group][0];
  const current = presetQuestions([preset])[0]?.question;
  expect(upgraded).toEqual({ ...current, minConfidence: 0.8 });
  if (!upgraded) throw new Error("Missing upgraded question");
  expect(questionFingerprint(upgraded, config.model)).not.toBe(
    questionFingerprint({ ...upgraded, ...previous }, config.model),
  );
  const custom = { ...previous, instructions: "My project-specific rubric" };
  const preserved = parseConfig({ ...config, questions: { [group]: [custom] } }).questions[group][0];
  expect(preserved?.instructions).toBe(custom.instructions);
  expect(preserved?.criteria).toEqual(custom.criteria);
});
