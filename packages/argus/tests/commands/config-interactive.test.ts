import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ConfigEditor } from "../../src/config/ConfigEditor";
import { loadConfig } from "../../src/config/loader";
import { cli, fixture } from "../helpers";

import { DOWN, ENTER, ESCAPE, interactive, UP } from "../terminal";

test("interactive config menu adds presets and edits a setting", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  await interactive(
    f.loaded.root,
    ["config", "--config", f.loaded.path],
    [
      { prompt: "Argus configuration", keys: [DOWN, ENTER] },
      { prompt: "Add presets", keys: [DOWN, " ", ENTER] },
      { prompt: "Argus configuration", keys: [UP, UP, ENTER] },
      { prompt: "Setting", keys: [UP, UP, ENTER] },
      { prompt: "maxQuestions", keys: ["\u007f", "\u007f", "16", ENTER] },
      { prompt: "Argus configuration", keys: [UP, ENTER] },
    ],
  );
  const config = loadConfig(f.loaded.path).config;
  expect(config.maxQuestions).toBe(16);
  expect(config.questions.methods.map((q) => q.id)).toEqual(["naming-accuracy", "comment-accuracy"]);
});

test("guided question creation, editing, cancellation and removal persist only completed operations", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  await interactive(
    f.loaded.root,
    ["config", "question", "add", "methods", "--config", f.loaded.path],
    [
      { prompt: "Question ID", keys: ["mutation", ENTER] },
      { prompt: "What should Jev evaluate?", keys: ["Does this mutate state?", ENTER] },
      { prompt: "Answer choices", keys: [ENTER] },
      { prompt: "Choice key", keys: ["yes", ENTER] },
      { prompt: "What does this choice mean?", keys: ["Mutates", ENTER] },
      { prompt: "Answer choices", keys: [DOWN, ENTER] },
      { prompt: "Choice key", keys: ["no", ENTER] },
      { prompt: "What does this choice mean?", keys: ["Read only", ENTER] },
      { prompt: "Answer choices", keys: [UP, ENTER] },
      { prompt: "Question: mutation", keys: [UP, ENTER] },
    ],
  );
  const created = loadConfig(f.loaded.path).config.questions.methods.find((q) => q.id === "mutation");
  expect(created?.criteria).toEqual({ yes: "Mutates", no: "Read only" });
  const edit = ["config", "question", "edit", "methods", "mutation", "--config", f.loaded.path];
  await interactive(f.loaded.root, edit, [
    { prompt: "Question: mutation", keys: [UP, UP, ENTER] },
    { prompt: "Minimum reporting confidence", keys: ["\u007f", "0.8", ENTER] },
    { prompt: "Question: mutation", keys: [UP, ENTER] },
  ]);
  expect(loadConfig(f.loaded.path).config.questions.methods.find((q) => q.id === "mutation")?.minConfidence).toBe(0.8);
  const saved = readFileSync(f.loaded.path, "utf8");
  await interactive(f.loaded.root, edit, [
    { prompt: "Question: mutation", keys: [ENTER] },
    { prompt: "Question ID", keys: ["-changed", ENTER] },
    { prompt: "Question: mutation-changed", keys: [ESCAPE] },
  ]);
  expect(readFileSync(f.loaded.path, "utf8")).toBe(saved);
  await interactive(
    f.loaded.root,
    ["config", "question", "remove", "--config", f.loaded.path],
    [
      { prompt: "Question group", keys: [ENTER] },
      { prompt: "Question", keys: [DOWN, ENTER] },
      { prompt: "Remove methods/mutation?", keys: ["y", ENTER] },
    ],
  );
  expect(loadConfig(f.loaded.path).config.questions.methods.map((q) => q.id)).toEqual(["naming-accuracy"]);
});

test("guided edits persist disabling the concern threshold", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  new ConfigEditor(f.loaded.path).editQuestion("methods", "naming-accuracy", { minConcernProbability: 0.6 });
  await interactive(
    f.loaded.root,
    ["config", "question", "edit", "methods", "naming-accuracy", "--config", f.loaded.path],
    [
      { prompt: "Question: naming-accuracy", keys: [UP, UP, UP, ENTER] },
      { prompt: "Select ambiguous candidates using combined concern probability?", keys: ["n"] },
      { prompt: "Question: naming-accuracy", keys: [UP, ENTER] },
    ],
  );
  expect(loadConfig(f.loaded.path).config.questions.methods[0]?.minConcernProbability).toBeUndefined();
});

test("guided edits configure review queues for custom answer choices", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  new ConfigEditor(f.loaded.path).addQuestion("methods", {
    id: "custom",
    type: "choice",
    instructions: "Check this contract",
    criteria: { unclear: "Missing context", clear: "Established" },
  });
  await interactive(
    f.loaded.root,
    ["config", "question", "edit", "methods", "custom", "--config", f.loaded.path],
    [
      { prompt: "Question: custom", keys: [UP, UP, UP, UP, ENTER] },
      { prompt: "Review queue for unclear", keys: [DOWN, ENTER] },
      { prompt: "Review queue for clear", keys: [ENTER] },
      { prompt: "Question: custom", keys: [UP, ENTER] },
    ],
  );
  expect(loadConfig(f.loaded.path).config.questions.methods.find((q) => q.id === "custom")?.reviewQueues).toEqual({
    unclear: "context",
    clear: "findings",
  });
});

test("removing an answer choice prunes its flags and queues before saving", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  new ConfigEditor(f.loaded.path).addQuestion("methods", {
    id: "custom",
    type: "choice",
    instructions: "Check the contract",
    criteria: { keep: "Retained concern", drop: "Removed concern", okay: "Established" },
    flag: ["keep", "drop"],
    reviewQueues: { keep: "findings", drop: "context" },
  });
  await interactive(
    f.loaded.root,
    ["config", "question", "edit", "methods", "custom", "--config", f.loaded.path],
    [
      { prompt: "Question: custom", keys: [DOWN, DOWN, ENTER] },
      { prompt: "Answer choices", keys: [DOWN, ENTER] },
      { prompt: "drop", keys: [DOWN, ENTER] },
      { prompt: "Answer choices", keys: [UP, ENTER] },
      { prompt: "Question: custom", keys: [UP, ENTER] },
    ],
  );
  const question = loadConfig(f.loaded.path).config.questions.methods.find((entry) => entry.id === "custom");
  expect(question?.criteria).toEqual({ keep: "Retained concern", okay: "Established" });
  expect(question?.flag).toEqual(["keep"]);
  expect(question?.reviewQueues).toEqual({ keep: "findings" });
});
