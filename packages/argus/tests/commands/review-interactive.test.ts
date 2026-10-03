import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseQuestion } from "../../src/config/validation";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { ReviewSnapshotStore } from "../../src/verification/ReviewSnapshotStore";
import { parseSubmission } from "../../src/verification/submission";
import { cli, fixture, response } from "../helpers";
import { DOWN, ENTER, ESCAPE, interactive } from "../terminal";

async function reviewFixture() {
  const f = fixture();
  f.loaded.root = realpathSync(f.loaded.root);
  f.loaded.config.root = f.loaded.root;
  f.loaded.config.questions.methods = [
    parseQuestion({
      id: "contract",
      type: "choice",
      context: "target",
      contextFiles: ["worker.gd"],
      instructions: "Does this method satisfy its contract?",
      criteria: { problem: "Needs review", okay: "Clear" },
      flag: ["problem"],
    }),
  ];
  f.write("example.gd", "func value():\n    return Worker.VALUE\n");
  f.write("worker.gd", "class_name Worker\nconst VALUE = 42\n");
  mkdirSync(f.loaded.stateDir, { recursive: true });
  symlinkSync(f.loaded.stateDir, join(f.loaded.root, ".argus"));
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const plan = await f.plan();
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(plan, new RequestBatcher().batches(plan, f.loaded.config));
  expect((await cli(f.loaded.root, ["report", "create"])).code).toBe(0);
  const snapshots = new ReviewSnapshotStore(f.loaded);
  const templatePath = snapshots.saveTemplate(snapshots.read());
  const template = parseSubmission(JSON.parse(readFileSync(templatePath, "utf8")));
  for (const item of template.verdicts) {
    item.verdict = "false_positive";
    item.rationale = "The supplied constant matches the returned value.";
  }
  writeFileSync(templatePath, JSON.stringify(template));
  return { ...f, snapshots, templatePath };
}

test("interactive review actions select inputs and retain root and submenu selections", async () => {
  const f = await reviewFixture();
  const output = await interactive(
    f.loaded.root,
    ["-i"],
    [
      { prompt: "What would you like to do?", keys: [DOWN, DOWN, DOWN, DOWN, ENTER] },
      { prompt: "report:", keys: [ENTER] },
      { prompt: "report:", keys: [DOWN, DOWN, ENTER], contains: "Argus review snapshot" },
      { prompt: "Review candidate", keys: [ESCAPE] },
      { prompt: "report:", keys: [ENTER], contains: "● show" },
      { prompt: "Review candidate", keys: [ENTER] },
      { prompt: "report:", keys: [DOWN, ENTER], contains: "● show" },
      { prompt: "Review candidate", keys: [ENTER] },
      { prompt: "Evidence fragment", keys: [DOWN, ENTER] },
      { prompt: "report:", keys: [DOWN, ENTER], contains: "● evidence" },
      { prompt: "Review batch", keys: [ENTER] },
      { prompt: "report:", keys: [ESCAPE], contains: "● batch" },
      { prompt: "What would you like to do?", keys: [ENTER], contains: "● report" },
      { prompt: "report:", keys: [ESCAPE], contains: "● batch" },
      { prompt: "What would you like to do?", keys: [DOWN, ENTER] },
      { prompt: "Verdict file to import", keys: [ENTER] },
      { prompt: "What would you like to do?", keys: [ESCAPE], contains: "Saved 1 verification verdicts" },
    ],
  );
  expect(output).toContain("const VALUE = 42");
  expect(output).toContain("verdictTemplate");
  expect(output).not.toContain("Unknown review ID");
  expect(output).not.toContain("Unknown evidence ID");
  expect((await cli(f.loaded.root, ["report", "create"])).stdout).toContain("0 candidates");
});

test("direct interactive commands offer pickers, manual verdict paths and safe cancellation", async () => {
  const f = await reviewFixture();
  const before = readFileSync(f.templatePath, "utf8");
  for (const command of ["show", "evidence"])
    await interactive(f.loaded.root, ["report", command], [{ prompt: "Review candidate", keys: [ESCAPE] }]);
  await interactive(f.loaded.root, ["report", "batch"], [{ prompt: "Review batch", keys: [ESCAPE] }]);
  await interactive(f.loaded.root, ["verify"], [{ prompt: "Verdict file to import", keys: [ESCAPE] }]);
  expect(readFileSync(f.templatePath, "utf8")).toBe(before);
  expect((await cli(f.loaded.root, ["report", "create"])).stdout).toContain("1 candidates");
  const output = await interactive(
    f.loaded.root,
    ["verify"],
    [
      { prompt: "Verdict file to import", keys: [DOWN, ENTER] },
      { prompt: "Verdict JSON path", keys: [f.templatePath, ENTER] },
    ],
  );
  expect(output).toContain("Saved 1 verification verdicts");
});

test("missing inputs without a terminal produce usage errors rather than undefined IDs", async () => {
  const f = await reviewFixture();
  for (const [args, message] of [
    [["report", "show"], "Use argus report show <review-id>"],
    [["report", "evidence"], "Use argus report evidence <evidence-id>"],
    [["report", "batch"], "Use argus report batch <number>"],
    [["verify"], "Use --import <verdicts.json>"],
  ] as const) {
    const result = await cli(f.loaded.root, [...args]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(message);
    expect(result.stdout + result.stderr).not.toContain("undefined");
  }
});

test("verdict picker shows modification dates and progress without being blocked by an unfinished file", async () => {
  const f = await reviewFixture();
  const emptyPath = f.snapshots.saveTemplate(f.snapshots.read(), "all-candidates");
  const older = new Date("2026-01-01T12:00:00Z");
  const newer = new Date("2026-01-02T12:00:00Z");
  utimesSync(emptyPath, older, older);
  utimesSync(f.templatePath, newer, newer);
  expect(f.snapshots.templates()).toEqual([
    { path: f.templatePath, modified: newer.getTime(), progress: { completed: 1, total: 1 } },
    { path: emptyPath, modified: older.getTime(), progress: { completed: 0, total: 1 } },
  ]);
  const output = await interactive(
    f.loaded.root,
    ["verify"],
    [{ prompt: "Verdict file to import", keys: [ESCAPE], contains: "1/1 completed" }],
  );
  expect(output).toContain("Modified ");
  expect(output).toContain("0/1 completed");
  writeFileSync(emptyPath, '{"version":');
  const invalid = await interactive(
    f.loaded.root,
    ["verify"],
    [{ prompt: "Verdict file to import", keys: [ESCAPE], contains: "Invalid or incomplete template" }],
  );
  expect(invalid).toContain("1/1 completed");
  expect(invalid).toContain("Enter a file path");
});

test("snapshot creation prompts for a required Git base before capturing files", async () => {
  const f = await reviewFixture();
  const question = f.loaded.config.questions.methods[0];
  if (!question) throw new Error("Missing question");
  f.loaded.config.questions.changes = [{ ...question, id: "change-contract" }];
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const snapshotId = f.snapshots.read().snapshotId;
  await interactive(
    f.loaded.root,
    ["report", "create"],
    [{ prompt: "Git base revision for change questions", keys: [ESCAPE] }],
  );
  expect(f.snapshots.read().snapshotId).toBe(snapshotId);
  const direct = await cli(f.loaded.root, ["report", "create"]);
  expect(direct.code).toBe(1);
  expect(direct.stdout + direct.stderr).toContain("Change questions require --base");
});

test("empty review menus explain their state and verification still offers a manual path", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init"])).code).toBe(0);
  const output = await interactive(
    f.loaded.root,
    ["-i"],
    [
      { prompt: "What would you like to do?", keys: [DOWN, DOWN, DOWN, DOWN, ENTER] },
      { prompt: "report:", keys: [ENTER] },
      { prompt: "report:", keys: [DOWN, DOWN, ENTER] },
      { prompt: "report:", keys: [DOWN, DOWN, ENTER], contains: "No review candidates" },
      { prompt: "report:", keys: [ESCAPE], contains: "No review batches" },
      { prompt: "What would you like to do?", keys: [ESCAPE] },
    ],
  );
  expect(output).not.toContain("Unknown review ID");
  const fresh = fixture();
  expect((await cli(fresh.loaded.root, ["init"])).code).toBe(0);
  await interactive(
    fresh.loaded.root,
    ["verify"],
    [
      { prompt: "Verdict file to import", keys: [ENTER], contains: "Enter a file path" },
      { prompt: "Verdict JSON path", keys: [ESCAPE] },
    ],
  );
});
