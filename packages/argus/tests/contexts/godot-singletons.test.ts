import { expect, test } from "bun:test";
import { parseQuestion } from "../../src/config/validation";
import { fixture } from "../helpers";

const PROTOTYPE_NAMES = ["toString", "constructor", "__proto__"];

async function singletonContext(name: string, files: Record<string, string>) {
  const f = fixture();
  f.loaded.config.questions.methods = [
    parseQuestion({
      id: "singleton-contract",
      type: "choice",
      context: "references",
      instructions: "Check the singleton contract",
      criteria: { yes: "Matches", no: "Does not match" },
    }),
  ];
  f.write("target.gd", `func value():\n    return ${name}.value()\n`);
  for (const [path, source] of Object.entries(files)) f.write(path, source);
  const item = (await f.plan()).items.find((entry) => entry.target.path === "target.gd");
  if (!item) throw new Error("Missing singleton review");
  return item.context;
}

test.each(PROTOTYPE_NAMES)("global class %s is not mistaken for an autoload", async (name) => {
  const context = await singletonContext(name, {
    "global.gd": `class_name ${name}\nstatic func value():\n    return 42\n`,
  });
  expect(context.related.find((entry) => entry.path === "global.gd")?.source).toContain("return 42");
  expect(context.related.find((entry) => entry.path === "project.godot")).toBeUndefined();
});

test.each(PROTOTYPE_NAMES)("missing %s stays unresolved without inventing an autoload", async (name) => {
  const context = await singletonContext(name, {});
  expect(context.related).toHaveLength(0);
  expect(context.unresolved?.flatMap((entry) => entry.expressions)).toContain(`${name}.value()`);
});

test.each([...PROTOTYPE_NAMES, "Service"])("configured own autoload %s retains precedence", async (name) => {
  const context = await singletonContext(name, {
    "project.godot": `[autoload]\n${name}="*res://singleton.gd"\n`,
    "singleton.gd": "extends Node\nfunc value():\n    return 7\n",
    "global.gd": `class_name ${name}\nstatic func value():\n    return 42\n`,
  });
  expect(context.related.find((entry) => entry.path === "singleton.gd")?.source).toContain("return 7");
  expect(context.related.find((entry) => entry.path === "global.gd")).toBeUndefined();
  expect(context.related.find((entry) => entry.path === "project.godot")?.source).toContain(
    `${name}="*res://singleton.gd"`,
  );
});
