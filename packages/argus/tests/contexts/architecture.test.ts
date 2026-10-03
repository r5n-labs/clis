import { expect, test } from "bun:test";
import { fixture } from "../helpers";

test("oversized architecture uses explicit partial evidence and invalidates even omitted bodies", async () => {
  const f = fixture("all");
  f.loaded.config.questions.changes = [];
  const large = "x".repeat(120_000);
  const source = `class_name Huge\nvar helper: Node\nfunc tick():\n    helper.process()\nfunc enormous():\n    return "${large}"\n`;
  f.write("huge.gd", source);
  const plan = await f.plan();
  const architecture = plan.items.find((item) => item.question.id === "architecture-ownership");
  const method = plan.items.find((item) => item.target.name === "enormous" && item.question.id === "naming-accuracy");
  expect(architecture?.blocked).toBeUndefined();
  expect(architecture?.context.source).toContain("PARTIAL ARCHITECTURE OVERVIEW");
  expect(architecture?.context.source).toContain("helper.process()");
  expect(architecture?.context.source).not.toContain(large);
  expect(architecture?.context.notes?.join(" ")).toContain("Omitted code");
  expect(method?.blocked).toBeDefined();
  expect(method?.context.source).toContain(large);
  f.write("huge.gd", source.replace(large, `${large}x`));
  expect((await f.plan()).items.find((item) => item.question.id === "architecture-ownership")?.inputHash).not.toBe(
    architecture?.inputHash,
  );
});
