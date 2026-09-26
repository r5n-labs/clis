import { expect, test } from "bun:test";
import { parseQuestion } from "../../src/config/validation";
import type { ContextMode } from "../../src/domain/question";
import { fixture } from "../helpers";

const MODES = ["class", "references"] as const;

function inheritedFixture(mode: ContextMode, source = "func enabled():\n    return flag\n") {
  const f = fixture();
  f.loaded.config.questions.methods = [
    parseQuestion({
      id: "inherited-contract",
      type: "choice",
      context: mode,
      instructions: "Check the inherited contract",
      criteria: { yes: "Matches", no: "Does not match" },
    }),
  ];
  f.write("derived.gd", `class_name Derived\nextends Intermediate\n${source}`);
  f.write("intermediate.gd", "class_name Intermediate\nextends Base\n");
  return {
    ...f,
    async item() {
      const item = (await f.plan()).items.find((entry) => entry.target.path === "derived.gd");
      if (!item) throw new Error("Missing derived review");
      return item;
    },
  };
}

test.each(MODES)("%s context includes inherited fields and constants in cache inputs", async (mode) => {
  const f = inheritedFixture(mode);
  const source = "class_name Base\nconst DEFAULT_FLAG = true\nvar flag = DEFAULT_FLAG\nvar irrelevant = false\n";
  f.write("base.gd", source);
  const initial = await f.item();
  const base = initial.context.related.find((entry) => entry.path === "base.gd")?.source;
  expect(base).toContain("var flag = DEFAULT_FLAG");
  expect(base).toContain("const DEFAULT_FLAG = true");
  expect(base).not.toContain("irrelevant");
  expect(initial.context.unresolved?.flatMap((entry) => entry.expressions) ?? []).not.toContain("flag");
  f.write("base.gd", source.replace("DEFAULT_FLAG = true", "DEFAULT_FLAG = false"));
  expect((await f.item()).inputHash).not.toBe(initial.inputHash);
  f.write("base.gd", source.replace("flag = DEFAULT_FLAG", "flag = false"));
  expect((await f.item()).inputHash).not.toBe(initial.inputHash);
  f.write("base.gd", source.replace("irrelevant = false", "irrelevant = true"));
  expect((await f.item()).inputHash).toBe(initial.inputHash);
});

test.each(MODES)("%s context preserves local shadowing and overridden fields", async (mode) => {
  const sources = [
    "func enabled(flag):\n    return flag\n",
    "func enabled():\n    var flag = false\n    return flag\n",
    "var flag = false\nfunc enabled():\n    return flag\n",
  ];
  for (const source of sources) {
    const f = inheritedFixture(mode, source);
    f.write("base.gd", "class_name Base\nvar flag = true\n");
    const initial = await f.item();
    expect(initial.context.related.find((entry) => entry.path === "base.gd")?.source ?? "").not.toContain("var flag");
    f.write("base.gd", "class_name Base\nvar flag = false\n");
    expect((await f.item()).inputHash).toBe(initial.inputHash);
  }
});

test.each(MODES)("%s context terminates inherited member lookup cycles", async (mode) => {
  const f = inheritedFixture(mode);
  f.write("base.gd", "class_name Base\nextends Derived\nvar flag = true\n");
  const item = await f.item();
  expect(item.context.related.find((entry) => entry.path === "base.gd")?.source).toContain("var flag = true");
});

test.each(MODES)("%s context preserves external depth limits for inherited initialisers", async (mode) => {
  const f = inheritedFixture(mode);
  f.write("base.gd", "class_name Base\nvar flag = External.value()\n");
  f.write("external.gd", "class_name External\nstatic func value():\n    return Further.value()\n");
  f.write("further.gd", "class_name Further\nstatic func value():\n    return true\n");
  const { context } = await f.item();
  expect(context.related.find((entry) => entry.path === "base.gd")?.source).toContain("var flag = External.value()");
  const external = context.related.find((entry) => entry.path === "external.gd");
  if (mode === "class") {
    expect(external).toBeUndefined();
    expect(context.unresolved?.flatMap((entry) => entry.expressions)).toContain("flag");
  } else {
    expect(external?.source).toContain("return Further.value()");
    expect(context.unresolved?.flatMap((entry) => entry.expressions)).toContain("Further.value()");
  }
  expect(context.related.find((entry) => entry.path === "further.gd")).toBeUndefined();
});
