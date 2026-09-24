import { expect, test } from "bun:test";
import { existsSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseQuestion } from "../../src/config/validation";
import type { Evaluation } from "../../src/domain/evaluation";
import type { ApiPayload } from "../../src/domain/review-plan";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { EvaluationStore } from "../../src/storage/EvaluationStore";
import { fixture, response } from "../helpers";

const SOURCE =
  "class_name Example\nextends Node\nvar count: int = 0\n\nfunc increment() -> void:\n    count += 1\n\nfunc get_count() -> int:\n    return count\n";

test("only new or edited questions run; relocation, question order and report thresholds reuse answers", async () => {
  const f = fixture();
  f.write("example.gd", SOURCE);
  const first = await f.plan();
  const batcher = new RequestBatcher();
  const sent: number[] = [];
  const runner = new ReviewRunner(f.store, {
    async evaluate(payload) {
      sent.push(Object.keys(payload.questions).length);
      return response(payload);
    },
  });
  await runner.run(first, batcher.batches(first, f.loaded.config));
  expect(sent).toEqual([1, 1]);
  expect(batcher.batches(await f.plan(), f.loaded.config)).toHaveLength(0);
  const extra = parseQuestion({
    id: "side-effects",
    type: "choice",
    context: "class",
    instructions: "Is there mutation?",
    criteria: { yes: "Mutates state", no: "No mutation" },
  });
  f.loaded.config.questions.methods.push(extra);
  const added = await f.plan();
  expect(added.items.filter((item) => !item.evaluation).map((item) => item.question.id)).toEqual([
    "side-effects",
    "side-effects",
  ]);
  await runner.run(added, batcher.batches(added, f.loaded.config));
  f.write("example.gd", `\n\n${SOURCE}`);
  f.loaded.config.questions.methods.reverse();
  extra.minConfidence = 0.9;
  extra.flag = ["yes"];
  expect(batcher.batches(await f.plan(), f.loaded.config)).toHaveLength(0);
  extra.instructions = "Does it mutate external state?";
  expect((await f.plan()).items.filter((item) => !item.evaluation).map((item) => item.question.id)).toEqual([
    "side-effects",
    "side-effects",
  ]);
});

test("changing one method invalidates only its questions; declarations and called helpers are dependencies", async () => {
  const f = fixture();
  f.write("example.gd", `${SOURCE}\nfunc twice() -> void:\n    increment()\n    increment()\n`);
  const first = await f.plan();
  const runner = new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  });
  await runner.run(first, new RequestBatcher().batches(first, f.loaded.config));
  f.write(
    "example.gd",
    `${SOURCE.replace("count += 1", "count += 2")}\nfunc twice() -> void:\n    increment()\n    increment()\n`,
  );
  expect((await f.plan()).items.filter((item) => !item.evaluation).map((item) => item.target.name)).toEqual([
    "increment",
    "twice",
  ]);
  f.write("example.gd", SOURCE.replace("var count: int = 0", "var count: int = 5"));
  expect((await f.plan()).items.every((item) => !item.evaluation)).toBe(true);
});

test("questions sharing context are batched after cached questions are removed", async () => {
  const f = fixture();
  f.write("example.gd", SOURCE);
  const naming = f.loaded.config.questions.methods[0];
  if (!naming) throw new Error("Missing naming preset");
  naming.context = "file";
  const batcher = new RequestBatcher();
  const initial = await f.plan();
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    initial,
    batcher.batches(initial, f.loaded.config),
  );
  f.loaded.config.questions.methods.push({ ...naming, id: "other", instructions: "Another question" });
  const plan = await f.plan();
  expect(plan.items.filter((item) => item.evaluation).map((item) => item.question.id)).toEqual([
    "naming-accuracy",
    "naming-accuracy",
  ]);
  const batches = batcher.batches(plan, { ...f.loaded.config, maxQuestions: 2 });
  expect(batches).toHaveLength(1);
  expect(batches[0]?.items.map((item) => [item.target.name, item.question.id])).toEqual([
    ["increment", "other"],
    ["get_count", "other"],
  ]);
  expect(Object.values(batches[0]?.payload.questions ?? {}).map((question) => question.instructions)).toEqual(
    plan.items.filter((item) => !item.evaluation).map((item) => item.apiQuestion.instructions),
  );
});

test("request limits accept exact question and UTF-8 byte boundaries and split one byte over", async () => {
  const f = fixture();
  f.write("example.gd", 'func greeting():\n    return "Cześć 👋"\n');
  const naming = f.loaded.config.questions.methods[0];
  if (!naming) throw new Error("Missing naming preset");
  f.loaded.config.questions.methods.push({ ...naming, id: "other", instructions: "Another question" });
  const plan = await f.plan();
  const batcher = new RequestBatcher();
  const batch = batcher.batches(plan, f.loaded.config)[0];
  if (!batch) throw new Error("Missing request");
  const serialised = JSON.stringify(batch.payload);
  const exactBytes = Buffer.byteLength(serialised);
  expect(exactBytes).toBeGreaterThan(serialised.length);
  const limits = { ...f.loaded.config, maxQuestions: 2, maxRequestBytes: exactBytes };
  expect(batcher.batches(plan, limits).map((entry) => entry.payload)).toEqual([batch.payload]);
  const split = batcher.batches(plan, { ...limits, maxRequestBytes: exactBytes - 1 });
  expect(split.map((entry) => entry.items.length)).toEqual([1, 1]);
  expect(split.flatMap((entry) => entry.items)).toEqual(batch.items);
  for (const entry of split) expect(Buffer.byteLength(JSON.stringify(entry.payload))).toBeLessThan(exactBytes);
  expect(batcher.batches(plan, { ...limits, maxQuestions: 1 }).map((entry) => entry.items.length)).toEqual([1, 1]);
  const single = split[0];
  if (!single) throw new Error("Missing single-question request");
  const singlePlan = { ...plan, items: single.items };
  const singleBytes = Buffer.byteLength(JSON.stringify(single.payload));
  expect(batcher.batches(singlePlan, { ...limits, maxRequestBytes: singleBytes })[0]?.payload).toEqual(single.payload);
  expect(() => batcher.batches(singlePlan, { ...limits, maxRequestBytes: singleBytes - 1 })).toThrow(
    "Context too large",
  );
  expect(existsSync(f.store.directory)).toBe(false);
});

test("partial failures preserve completed work and lock prevents concurrent billing", async () => {
  const f = fixture();
  f.write("example.gd", SOURCE);
  const release = f.store.lock();
  expect(() => f.store.lock()).toThrow("locked");
  release();
  const first = await f.plan();
  let requests = 0;
  const runner = new ReviewRunner(f.store, {
    async evaluate(payload) {
      requests++;
      if (requests === 2) throw new Error("offline");
      return response(payload);
    },
  });
  await expect(runner.run(first, new RequestBatcher().batches(first, f.loaded.config))).rejects.toThrow("offline");
  const resumed = await f.plan();
  expect(resumed.items.filter((item) => item.evaluation)).toHaveLength(1);
  expect(new RequestBatcher().batches(resumed, f.loaded.config)).toHaveLength(1);
});

test("a saved response is recovered without billing again after an evaluation write fails", async () => {
  const f = fixture();
  f.write("example.gd", "func value():\n    return 1\n");
  class FailingStore extends EvaluationStore {
    override save(): void {
      throw new Error("disk full");
    }
  }
  let calls = 0;
  const client = {
    async evaluate(payload: Parameters<typeof response>[0]) {
      calls++;
      return response(payload);
    },
  };
  const plan = await f.plan();
  const batches = new RequestBatcher().batches(plan, f.loaded.config);
  await expect(new ReviewRunner(new FailingStore(f.store.directory), client).run(plan, batches)).rejects.toThrow(
    "disk full",
  );
  await new ReviewRunner(f.store, client).run(plan, batches);
  expect(calls).toBe(1);
  expect(plan.items[0]?.evaluation).toBeDefined();
});

test("model changes invalidate answers and source symlinks are not followed", async () => {
  const f = fixture();
  f.write("example.gd", SOURCE);
  symlinkSync(join(f.loaded.root, "example.gd"), join(f.loaded.root, "alias.gd"));
  const first = await f.plan();
  expect(first.targets).toBe(2);
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(first, new RequestBatcher().batches(first, f.loaded.config));
  f.loaded.config.model = "another-model";
  expect((await f.plan()).items.every((item) => !item.evaluation)).toBe(true);
});

test("automatic references add implementation context and invalidate tests when it changes", async () => {
  const f = fixture("all");
  f.loaded.config.questions.changes = [];
  f.write(
    "tests/test_counter.gd",
    "extends Node\nfunc test_count():\n    var counter = Counter.new()\n    assert(counter.value() == 1)\n",
  );
  f.write("counter.gd", "class_name Counter\nfunc value():\n    return 1\n");
  const plan = await f.plan();
  const item = plan.items.find((item) => item.target.group === "tests");
  expect(item?.context.related.map((entry) => entry.path)).toContain("counter.gd");
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(plan, new RequestBatcher().batches(plan, f.loaded.config));
  f.write("counter.gd", "class_name Counter\nfunc value():\n    return 2\n");
  expect((await f.plan()).items.find((item) => item.target.group === "tests")?.evaluation).toBeUndefined();
});

test("translation keys are paired automatically and source-language changes invalidate translations", async () => {
  const f = fixture("all");
  f.loaded.config.questions.changes = [];
  f.write("en.po", 'msgid ""\nmsgstr "Language: en\\n"\n\nmsgid "ui.start"\nmsgstr "Start game"\n');
  f.write("pl.po", 'msgid ""\nmsgstr "Language: pl\\n"\n\nmsgid "ui.start"\nmsgstr "Rozpocznij grę"\n');
  const plan = await f.plan();
  const polish = plan.items.find((item) => item.target.path === "pl.po");
  expect(polish?.context.related[0]?.source).toContain("Start game");
  expect(polish?.context.source).toContain("Language: pl");
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(plan, new RequestBatcher().batches(plan, f.loaded.config));
  f.write("en.po", 'msgid ""\nmsgstr "Language: en\\n"\n\nmsgid "ui.start"\nmsgstr "Start battle"\n');
  expect((await f.plan()).items.find((item) => item.target.path === "pl.po")?.evaluation).toBeUndefined();
});

test("partial multi-answer saves recover every answer before rebatching", async () => {
  const f = fixture();
  f.write("value.gd", "func value():\n    return 1\n");
  const original = f.loaded.config.questions.methods[0];
  if (!original) throw new Error("fixture question");
  f.loaded.config.questions.methods.push({ ...original, id: "second", instructions: "A second independent criterion" });
  let calls = 0;
  const client = {
    async evaluate(payload: ApiPayload) {
      calls++;
      return response(payload);
    },
  };
  class PartiallyFailingStore extends EvaluationStore {
    saved = 0;
    override save(value: Evaluation): void {
      if (++this.saved === 2) throw new Error("disk full after first answer");
      super.save(value);
    }
  }
  const plan = await f.plan();
  const batcher = new RequestBatcher();
  const batches = batcher.batches(plan, f.loaded.config);
  expect(batches).toHaveLength(1);
  expect(batches[0]?.items).toHaveLength(2);
  await expect(
    new ReviewRunner(new PartiallyFailingStore(f.store.directory), client).run(plan, batches),
  ).rejects.toThrow("disk full");
  const resumed = await f.plan();
  expect(resumed.items.filter((item) => item.evaluation)).toHaveLength(2);
  await new ReviewRunner(f.store, client).run(resumed, batcher.batches(resumed, f.loaded.config));
  expect(calls).toBe(1);
  expect(readdirSync(join(f.store.directory, "pending"))).toHaveLength(1);
  const restored = new EvaluationStore(f.store.directory);
  const release = restored.lock();
  try {
    expect(resumed.items.every((item) => restored.find(item))).toBe(true);
    expect(readdirSync(join(f.store.directory, "pending"))).toHaveLength(0);
  } finally {
    release();
  }
  f.loaded.config.questions.methods.push({ ...original, id: "third", instructions: "A new independent criterion" });
  const added = await f.plan();
  expect(batcher.batches(added, f.loaded.config)[0]?.items.map((item) => item.question.id)).toEqual(["third"]);
});

test("damaged recovery journals are rejected without leaking the run lock", async () => {
  const f = fixture();
  f.write("value.gd", "func value():\n    return 1\n");
  const plan = await f.plan();
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(plan, new RequestBatcher().batches(plan, f.loaded.config));
  const journal = join(f.store.directory, "pending", "damaged.json");
  writeFileSync(journal, JSON.stringify([{ ...plan.items[0]?.evaluation, answer: { choice: "invented" } }]));
  expect(() => f.store.recover()).toThrow("Invalid evaluation journal");
  expect(() => f.store.lock()).toThrow("Invalid evaluation journal");
  expect(existsSync(join(f.store.directory, "run.lock"))).toBe(false);
});
