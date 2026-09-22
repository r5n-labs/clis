import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigEditor } from "../../src/config/ConfigEditor";
import { loadConfig } from "../../src/config/loader";
import { cli, fixture } from "../helpers";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");
const PROMPT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 10;
const KEY_DELAY_MS = 30;
const DOWN = "\u001b[B";
const UP = "\u001b[A";
const ENTER = "\r";
const ESCAPE = "\u001b";

async function interactive(cwd: string, args: string[], steps: Array<{ prompt: string; keys: string[] }>) {
  let output = "";
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data(_terminal, data) {
      output += new TextDecoder().decode(data);
    },
  });
  const child = Bun.spawn(["bun", CLI, ...args], {
    cwd,
    env: { ...Bun.env, TERM: "xterm-256color", NO_COLOR: undefined, FORCE_COLOR: "1", TYPESAFE_API_KEY: "" },
    terminal,
  });
  try {
    for (const { prompt, keys } of steps) {
      const deadline = Date.now() + PROMPT_TIMEOUT_MS;
      while (!Bun.stripANSI(output).includes(`◆  ${prompt}`)) {
        if (Date.now() > deadline) throw new Error(`Missing prompt '${prompt}': ${Bun.stripANSI(output)}`);
        await Bun.sleep(POLL_INTERVAL_MS);
      }
      output = "";
      for (const key of keys) {
        terminal.write(key);
        await Bun.sleep(KEY_DELAY_MS);
      }
    }
    const timeout = setTimeout(() => child.kill(), PROMPT_TIMEOUT_MS);
    try {
      expect(await child.exited).toBe(0);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    child.kill();
    terminal.close();
  }
}

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
