import { expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigEditor } from "../../src/config/ConfigEditor";
import { parseQuestion } from "../../src/config/validation";
import { presetQuestions } from "../../src/presets";
import { llmParts, reviewCandidates } from "../../src/reports/llm";
import { llmSummary } from "../../src/reports/llm-summary";
import { reportData } from "../../src/reports/report-data";
import { selectCandidate } from "../../src/reports/selection";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { checksum } from "../../src/storage/fingerprints";
import { ReviewSnapshotStore } from "../../src/verification/ReviewSnapshotStore";
import { parseSubmission } from "../../src/verification/submission";
import { VerificationStore } from "../../src/verification/VerificationStore";
import { cli, fixture, response } from "../helpers";

async function reviewedFixture(source = "func delete_all():\n    return 1\n") {
  const f = fixture();
  f.loaded.root = realpathSync(f.loaded.root);
  f.loaded.config.root = f.loaded.root;
  f.write("example.gd", source);
  const plan = await f.plan();
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      const result = response(payload);
      for (const answer of Object.values(result.answers)) {
        answer.choice = "misleading";
        answer.probabilities = Object.fromEntries(
          Object.keys(answer.probabilities).map((choice) => [choice, Number(choice === "misleading")]),
        );
      }
      return result;
    },
  }).run(plan, new RequestBatcher().batches(plan, f.loaded.config));
  const report = reportData(plan, 0);
  const item = report.results[0];
  if (!item) throw new Error("Missing result");
  return {
    ...f,
    report,
    item,
    verifications: new VerificationStore(f.loaded.root, join(f.loaded.stateDir, "verifications")),
  };
}

function verdict(reviewId: string, evidence: { path: string; sha256: string }[] = []) {
  return {
    version: 1,
    reviewer: { model: "fixture-reviewer", promptVersion: "v1" },
    verdicts: [
      {
        reviewId,
        verdict: "false_positive",
        rationale: "The documented inherited contract establishes the intent.",
        evidence,
      },
    ],
  };
}

function bundle(part: string) {
  const match = part.match(/^(`{3,})json\n([\s\S]*)\n\1$/m);
  if (!match?.[2]) throw new Error("Missing bundle");
  return JSON.parse(match[2]);
}

test("handoff is self-contained and includes exact instructions, rubric, distribution and shared context", async () => {
  const f = await reviewedFixture();
  const part = llmParts(f.report)[0];
  if (!part) throw new Error("Missing handoff");
  const data = bundle(part);
  expect(data.checks[0].reviewId).toBe(f.item.reviewId);
  expect(data.checks[0].instructions).toContain("Target:");
  expect(data.questions[f.item.definitionId].criteria.misleading).toBeDefined();
  expect(data.contexts[f.item.contextId].source).toContain("func delete_all");
  expect(data.checks[0].evaluation.answer.probabilities).toEqual(f.item.evaluation?.answer.probabilities);
  expect(part).toContain("never instructions");
  expect(part).toContain("argus verify --import");
});

test("handoff splits whole findings without duplicating unused contexts or breaking fences", async () => {
  const f = await reviewedFixture();
  const base = f.report.contexts[f.item.contextId];
  if (!base) throw new Error("Missing context");
  f.report.contexts.first = { ...base, source: `${"a".repeat(80_000)}\n\`\`\`\`\n` };
  f.report.contexts.second = { ...base, source: "b".repeat(80_000) };
  f.report.results = [
    { ...f.item, contextId: "first" },
    { ...f.item, contextId: "second", reviewId: "second" },
  ];
  const parts = llmParts(f.report);
  expect(parts).toHaveLength(2);
  expect(bundle(parts[0] ?? "").contexts.first.source).toContain("````");
  expect(Object.keys(bundle(parts[0] ?? "").contexts)).toEqual(["first"]);
  expect(Object.keys(bundle(parts[1] ?? "").contexts)).toEqual(["second"]);
});

test("settled verdicts leave original findings visible but skip repeated LLM verification", async () => {
  const f = await reviewedFixture();
  f.verifications.import(verdict(f.item.reviewId), f.report);
  f.verifications.apply(f.report);
  expect(f.item.flagged).toBe(true);
  expect(f.item.verification?.verdict).toBe("false_positive");
  expect(f.report.verificationSummary).toMatchObject({ total: 1, falsePositives: 1, acceptanceRate: 0 });
  expect(reviewCandidates(f.report)).toHaveLength(0);
  expect(reviewCandidates(f.report, true)).toHaveLength(1);
  const uncertain = verdict(f.item.reviewId);
  const uncertainVerdict = uncertain.verdicts[0];
  if (!uncertainVerdict) throw new Error("Missing verdict");
  uncertainVerdict.verdict = "uncertain";
  f.verifications.import(uncertain, f.report);
  f.verifications.apply(f.report);
  expect(reviewCandidates(f.report)).toHaveLength(1);
  expect(f.report.verificationSummary).toMatchObject({ total: 1, uncertain: 1, acceptanceRate: null });
});

test("additional evidence changes invalidate verification; path escape and stale imports are rejected", async () => {
  const f = await reviewedFixture();
  f.write("contract.gd", "original");
  const review = verdict(f.item.reviewId, [{ path: "contract.gd", sha256: checksum("original") }]);
  f.verifications.import(review, f.report);
  f.verifications.apply(f.report);
  expect(f.item.verification).not.toBeNull();
  f.write("contract.gd", "changed");
  f.verifications.apply(f.report);
  expect(f.item.verification).toBeNull();
  expect(() => f.verifications.import(review, f.report)).toThrow("evidence changed");
  writeFileSync(join(f.directory, "outside.gd"), "outside");
  symlinkSync(join(f.directory, "outside.gd"), join(f.loaded.root, "escape.gd"));
  expect(() =>
    f.verifications.import(verdict(f.item.reviewId, [{ path: "escape.gd", sha256: checksum("outside") }]), f.report),
  ).toThrow("cannot be read");
  f.write("example.gd", "func delete_all():\n    return 2\n");
  const changed = reportData(await f.plan(), 0);
  expect(() => f.verifications.import(verdict(f.item.reviewId), changed)).toThrow("stale");
});

test("reporting-policy changes reuse Jev answers but invalidate downstream verification", async () => {
  const f = await reviewedFixture();
  f.verifications.import(verdict(f.item.reviewId), f.report);
  const question = f.loaded.config.questions.methods[0];
  if (!question) throw new Error("Missing question");
  question.minConcernProbability = 0.4;
  const changed = reportData(await f.plan(), 0);
  f.verifications.apply(changed);
  expect(changed.results[0]?.evaluation).not.toBeNull();
  expect(changed.results[0]?.reviewId).not.toBe(f.item.reviewId);
  expect(changed.results[0]?.verification).toBeNull();
});

test("combined concern probability selects ambiguity without treating it as a confident winning label", () => {
  const question = parseQuestion({
    id: "test",
    type: "choice",
    instructions: "Check",
    criteria: { clear: "Clear", wrong: "Wrong", missing: "Missing" },
    flag: ["wrong", "missing"],
    minConcernProbability: 0.5,
  });
  const answer = {
    type: "choice" as const,
    choice: "clear",
    confidence: 0.1,
    probabilities: { clear: 0.4, wrong: 0.35, missing: 0.25 },
  };
  expect(selectCandidate(question, answer)).toMatchObject({
    flagged: true,
    concernProbability: 0.6,
    selectionReason: "Combined probability of concerning answers",
  });
  delete question.minConcernProbability;
  expect(selectCandidate(question, answer).flagged).toBe(false);
  expect(() => parseQuestion({ ...question, minConcernProbability: 2 })).toThrow("probability");
});

test("stock preset upgrade is explicit, idempotent, and preserves custom questions", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  const editor = new ConfigEditor(f.loaded.path);
  editor.addPresets(["comments", "tests"]);
  expect(editor.upgradePresets()).toBe(2);
  expect(editor.config.questions.tests.map((q) => q.id)).toEqual(["test-meaningfulness", "test-promises"]);
  expect(editor.upgradePresets()).toBe(0);
  const legacy = presetQuestions(["comments"])[0];
  if (!legacy) throw new Error("Missing preset");
  editor.addQuestion("methods", { ...legacy.question, instructions: "Custom" });
  expect(editor.upgradePresets()).toBe(0);
  expect(editor.question("methods", "comment-accuracy").instructions).toBe("Custom");
});

test("CLI handoff and verdict import work offline and reject conflicting output modes", async () => {
  const f = await reviewedFixture();
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const result = await cli(f.loaded.root, ["report", "--config", f.loaded.path, "--llm"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(f.item.reviewId);
  const path = join(f.directory, "verdicts.json");
  writeFileSync(path, JSON.stringify(verdict(f.item.reviewId)));
  const imported = await cli(f.loaded.root, ["verify", "--config", f.loaded.path, "--import", path]);
  expect(imported.code).toBe(0);
  const next = await cli(f.loaded.root, ["report", "--config", f.loaded.path, "--llm"]);
  expect(next.stdout).toContain("No unverified");
  const summaryArgs = ["report", "--config", f.loaded.path, "--llm", "--summary"];
  const empty = await cli(f.loaded.root, summaryArgs);
  expect(empty.code).toBe(0);
  expect(empty.stdout).toContain("0 candidates · 0 batches");
  expect(empty.stdout).not.toContain("--batch 1");
  const included = await cli(f.loaded.root, [...summaryArgs, "--include-verified"]);
  expect(included.code).toBe(0);
  expect(included.stdout).toContain("1 candidates · 1 batches");
  expect(included.stdout).toContain("--include-verified --batch 1");
  const full = await cli(f.loaded.root, ["report", "--config", f.loaded.path, "--llm", "--include-verified"]);
  expect(full.code).toBe(0);
  const fullPath = full.stderr.match(/^Verdict template: (.+)$/m)?.[1];
  const emptyPath = next.stderr.match(/^Verdict template: (.+)$/m)?.[1];
  if (!fullPath || !emptyPath) throw new Error("Missing verdict files");
  expect(fullPath).not.toBe(emptyPath);
  expect(parseSubmission(JSON.parse(readFileSync(fullPath, "utf8"))).verdicts).toHaveLength(1);
  expect(parseSubmission(JSON.parse(readFileSync(emptyPath, "utf8"))).verdicts).toHaveLength(0);
  expect((await cli(f.loaded.root, ["report", "--config", f.loaded.path, "--llm", "--html"])).code).toBe(1);
});

test("CLI exports all handoff parts by default and selects only an explicitly requested batch", async () => {
  const SOURCE_CHARACTERS = 65_000;
  const f = await reviewedFixture(
    `func delete_first():\n    return "${"a".repeat(SOURCE_CHARACTERS)}"\n\nfunc delete_second():\n    return "${"b".repeat(SOURCE_CHARACTERS)}"\n`,
  );
  expect(llmParts(f.report)).toHaveLength(2);
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const args = ["report", "--config", f.loaded.path, "--llm"];
  const summary = await cli(f.loaded.root, [...args, "--summary"]);
  expect(summary.code).toBe(0);
  expect(summary.stdout).toContain("2 candidates · 2 batches");
  expect(summary.stdout).toContain("naming-accuracy: 2");
  expect(summary.stdout).toContain(`argus report --llm --config ${f.loaded.path} --batch 1`);
  expect(summary.stdout).toContain("Batch numbers: 1–2");
  expect(summary.stdout).not.toContain("func delete_first");
  expect(summary.stdout).not.toContain("```json");
  const all = await cli(f.loaded.root, args);
  expect(all.code).toBe(0);
  expect(all.stdout).toContain("part 1/2");
  expect(all.stdout).toContain("part 2/2");
  for (const item of f.report.results) expect(all.stdout).toContain(item.reviewId);
  for (const batch of [1, 2]) {
    const selected = await cli(f.loaded.root, [...args, "--batch", String(batch)]);
    expect(selected.code).toBe(0);
    expect(selected.stdout.match(/# Argus review handoff/g)).toHaveLength(1);
    expect(selected.stdout).toContain(`part ${batch}/2`);
    const savedPath = selected.stderr.match(/^Verdict template: (.+)$/m)?.[1];
    if (!savedPath) throw new Error("Missing complete verdict file");
    expect(parseSubmission(JSON.parse(readFileSync(savedPath, "utf8"))).verdicts.map((item) => item.reviewId)).toEqual(
      f.report.results.map((item) => item.reviewId),
    );
    expect(bundle(selected.stdout).checks.map((item: { reviewId: string }) => item.reviewId)).toEqual([
      f.report.results[batch - 1]?.reviewId,
    ]);
  }
  const missing = await cli(f.loaded.root, [...args, "--batch", "3"]);
  expect(missing.code).toBe(1);
  expect(missing.stdout + missing.stderr).toContain("There are 2 handoff parts");
});

test.each(["0", "-1", "1.5"])("CLI rejects invalid handoff batch %s", async (batch) => {
  const f = fixture();
  const result = await cli(f.loaded.root, ["report", "--llm", `--batch=${batch}`]);
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).toContain("--batch must be a positive integer");
});

test("CLI requires LLM output even when the explicitly selected batch is one", async () => {
  const f = fixture();
  const result = await cli(f.loaded.root, ["report", "--batch", "1"]);
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).toContain("require --llm");
});

test.each([
  [["--summary"], "--summary requires --llm"],
  [["--llm", "--summary", "--batch", "1"], "Choose either --summary or --batch"],
  [["--llm", "--summary", "--json"], "Choose one of --llm, --json or --html"],
  [["--llm", "--summary", "--html"], "Choose one of --llm, --json or --html"],
])("CLI rejects conflicting summary options %j", async (args, message) => {
  const f = fixture();
  const result = await cli(f.loaded.root, ["report", ...args]);
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).toContain(message);
});

test("summary commands preserve shell-sensitive config paths, Git bases and selection options", async () => {
  const f = await reviewedFixture();
  const config = join(f.directory, "review's $(echo unexpected).json");
  const base = "release's branch";
  const summary = llmSummary(f.report, {
    candidates: reviewCandidates(f.report),
    batches: 1,
    config,
    base,
    includeVerified: true,
  });
  const command = summary.split("\n").find((line) => line.startsWith("argus report") && line.endsWith("--batch 1"));
  if (!command) throw new Error("Missing batch command");
  const result = Bun.spawnSync(["sh", "-c", `set -- ${command}; printf '%s\\n' "$@"`], { stdout: "pipe" });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim().split("\n")).toEqual([
    "argus",
    "report",
    "--llm",
    "--config",
    config,
    "--base",
    base,
    "--include-verified",
    "--batch",
    "1",
  ]);
});

test("LLM export supplies a template that imports partial verdicts with automatic evidence hashes", async () => {
  const f = await reviewedFixture("func delete_all():\n    return 1\n\nfunc delete_other():\n    return 2\n");
  f.write("guide.md", "This helper intentionally returns a preview.");
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const args = ["report", "--config", f.loaded.path, "--llm"];
  expect((await cli(f.loaded.root, [...args, "--summary"])).code).toBe(0);
  expect(existsSync(join(f.loaded.stateDir, "reviews"))).toBe(false);
  const exported = await cli(f.loaded.root, args);
  expect(exported.code).toBe(0);
  const file = exported.stderr.match(/^Verdict template: (.+)$/m)?.[1];
  if (!file) throw new Error("Missing saved verdict template path");
  expect(file.startsWith(join(f.loaded.stateDir, "reviews"))).toBe(true);
  expect(exported.stdout).toContain(file);
  const template = parseSubmission(JSON.parse(readFileSync(file, "utf8")));
  expect(template).toEqual(bundle(exported.stdout).verdictTemplate);
  expect(template.verdicts.map((entry) => entry.reviewId)).toEqual(f.report.results.map((entry) => entry.reviewId));
  expect(template.reviewer.model).toBe("unknown");
  const first = template.verdicts[0];
  if (!first) throw new Error("Missing template verdict");
  first.verdict = "false_positive";
  first.rationale = "The documented contract establishes this as a preview.";
  first.evidence = ["guide.md"];
  writeFileSync(file, JSON.stringify(template));
  const again = await cli(f.loaded.root, args);
  expect(again.code).toBe(0);
  expect(again.stderr).toContain(file);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(template);
  const result = await cli(f.loaded.root, ["verify", "--config", f.loaded.path, "--import", file, "--json"]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ imported: 1, remaining: 1, uncertain: 0 });
  f.verifications.apply(f.report);
  expect(f.item.verification?.evidence).toEqual([
    { path: "guide.md", sha256: checksum("This helper intentionally returns a preview.") },
  ]);
  expect(f.item.verification?.reviewer.model).toBe("unknown");
  const next = await cli(f.loaded.root, args);
  expect(bundle(next.stdout).verdictTemplate.verdicts).toHaveLength(1);
});

test("snapshot imports reject changed, new, excluded and escaping evidence without saving other verdicts", async () => {
  const f = await reviewedFixture();
  f.write("guide.md", "before review");
  f.write("excluded/guide.md", "not captured");
  f.loaded.config.exclude.push("excluded");
  const snapshots = new ReviewSnapshotStore(f.loaded);
  const files = snapshots.captureFiles();
  snapshots.save(f.report, files);
  const template = parseSubmission(bundle(llmParts(f.report)[0] ?? "").verdictTemplate);
  const first = template.verdicts[0];
  if (!first) throw new Error("Missing verdict");
  first.verdict = "confirmed";
  first.rationale = "Reviewed against the guide.";
  f.write("guide.md", "changed after export");
  first.evidence = ["guide.md"];
  expect(() => f.verifications.import(snapshots.resolve(template), f.report)).toThrow("evidence changed");
  f.write("new.md", "created after export");
  for (const path of ["new.md", "excluded/guide.md", "../outside.md", join(f.loaded.root, "guide.md")]) {
    first.evidence = [path];
    expect(() => snapshots.resolve(template)).toThrow("not captured");
  }
  first.evidence = [];
  expect(() => snapshots.resolve({ ...template, verdicts: [first, first] })).toThrow("Duplicate");
  expect(() =>
    snapshots.resolve({ ...template, verdicts: [first, { ...first, reviewId: checksum("unknown") }] }),
  ).toThrow("Unknown review ID");
  expect(() => snapshots.resolve({ ...template, verdicts: [{ ...first, rationale: " " }] })).toThrow(
    "Missing rationale",
  );
  expect(() => snapshots.resolve({ ...template, verdicts: [{ ...first, verdict: "" }] })).toThrow("Missing verdict");
  expect(() => snapshots.resolve({ ...template, verdicts: [{ ...first, verdict: "maybe" }] })).toThrow(
    "Unknown verification verdict",
  );
  f.write("example.gd", "func delete_all():\n    return 3\n");
  const changed = reportData(await f.plan(), 0);
  expect(() => f.verifications.import(snapshots.resolve(template), changed)).toThrow("stale");
  expect(existsSync(join(f.loaded.stateDir, "verifications"))).toBe(false);
});

test("HTML copy templates share a saved snapshot and altered snapshots cannot certify verdicts", async () => {
  const f = await reviewedFixture();
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const htmlPath = join(f.directory, "report.html");
  const result = await cli(f.loaded.root, ["report", "--config", f.loaded.path, "--html", htmlPath]);
  expect(result.code).toBe(0);
  const data = readFileSync(htmlPath, "utf8").match(
    /<script id="argus-report-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  if (!data) throw new Error("Missing HTML report data");
  const report = JSON.parse(data);
  expect(parseSubmission(JSON.parse(readFileSync(report.verdictFile, "utf8"))).verdicts).toHaveLength(1);
  const template = parseSubmission(bundle(llmParts(report)[0] ?? "").verdictTemplate);
  const snapshots = new ReviewSnapshotStore(f.loaded);
  expect(snapshots.resolve(template).verdicts).toEqual([]);
  const path = join(f.loaded.stateDir, "reviews", `${template.snapshotId}.json`);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  expect(saved.report.contexts).toEqual(report.contexts);
  saved.report.model = "modified";
  writeFileSync(path, JSON.stringify(saved));
  expect(() => snapshots.resolve(template)).toThrow("does not match its snapshot");
});

test("HTML verdict files cover filtered and settled checks while CLI templates retain candidate selection", async () => {
  const f = await reviewedFixture(
    "func first():\n    return 1\n\nfunc second():\n    return 2\n\nfunc third():\n    return 3\n",
  );
  f.verifications.import(verdict(f.item.reviewId), f.report);
  const matched = f.report.results[1]?.evaluation;
  if (!matched) throw new Error("Missing evaluation");
  const answer = {
    ...matched.answer,
    choice: "matches",
    probabilities: Object.fromEntries(
      Object.keys(matched.answer.probabilities).map((key) => [key, Number(key === "matches")]),
    ),
  };
  f.store.save({ ...matched, answer });
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const htmlPath = join(f.directory, "all-checks.html");
  const exported = await cli(f.loaded.root, ["report", "--config", f.loaded.path, "--html", htmlPath]);
  expect(exported.code).toBe(0);
  const data = readFileSync(htmlPath, "utf8").match(
    /<script id="argus-report-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  if (!data) throw new Error("Missing report data");
  const report = JSON.parse(data);
  const template = parseSubmission(JSON.parse(readFileSync(report.verdictFile, "utf8")));
  expect(template.verdicts.map((entry) => entry.reviewId)).toEqual(
    report.results.map((entry: { reviewId: string }) => entry.reviewId),
  );
  for (const item of report.results) {
    const handoff = llmParts(report, [item])[0] ?? "";
    expect(handoff).toContain(report.verdictFile);
    expect(template.verdicts.some((entry) => entry.reviewId === bundle(handoff).checks[0].reviewId)).toBe(true);
  }
  const filled = template.verdicts[1];
  if (!filled) throw new Error("Missing matched check");
  filled.verdict = "false_positive";
  filled.rationale = "The selected method returns exactly what its local contract promises.";
  writeFileSync(report.verdictFile, JSON.stringify(template));
  const exportedAgain = await cli(f.loaded.root, [
    "report",
    "--config",
    f.loaded.path,
    "--html",
    join(f.directory, "again.html"),
  ]);
  expect(exportedAgain.code).toBe(0);
  expect(JSON.parse(readFileSync(report.verdictFile, "utf8"))).toEqual(template);
  const handoff = await cli(f.loaded.root, ["report", "--config", f.loaded.path, "--llm"]);
  expect(handoff.code).toBe(0);
  const candidatePath = handoff.stderr.match(/^Verdict template: (.+)$/m)?.[1];
  if (!candidatePath) throw new Error("Missing candidate template");
  expect(candidatePath).not.toBe(report.verdictFile);
  expect(parseSubmission(JSON.parse(readFileSync(candidatePath, "utf8"))).verdicts).toHaveLength(1);
  const imported = await cli(f.loaded.root, [
    "verify",
    "--config",
    f.loaded.path,
    "--import",
    report.verdictFile,
    "--json",
  ]);
  expect(imported.code).toBe(0);
  expect(JSON.parse(imported.stdout)).toMatchObject({ imported: 1, remaining: 1 });
});

test("snapshots ignore state, excluded files and symlinks, and reuse unchanged export identities", async () => {
  const f = await reviewedFixture();
  f.write(".argus/ignored.txt", "generated state");
  f.write("guide.md", "documentation");
  writeFileSync(join(f.directory, "outside.md"), "outside");
  symlinkSync(join(f.directory, "outside.md"), join(f.loaded.root, "link.md"));
  const snapshots = new ReviewSnapshotStore(f.loaded);
  const files = snapshots.captureFiles();
  expect(Object.keys(files)).toEqual(["example.gd", "guide.md"]);
  snapshots.save(f.report, files);
  const first = f.report.snapshotId;
  f.report.generatedAt = "different export time";
  snapshots.save(f.report, files);
  expect(f.report.snapshotId).toBe(first);
});

test("a config in the project root excludes its generated state from file snapshots", async () => {
  const f = await reviewedFixture();
  f.loaded.stateDir = f.loaded.root;
  f.write("reviews/old.json", "generated snapshot");
  f.write("cache/entry.json", "generated cache");
  f.write("__proto__", "ordinary text file");
  const files = new ReviewSnapshotStore(f.loaded).captureFiles();
  expect(Object.keys(files)).toEqual(["__proto__", "example.gd"]);
  expect(Object.getOwnPropertyDescriptor(files, "__proto__")?.value).toBe(checksum("ordinary text file"));
});
