import { expect, test } from "bun:test";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig, parseQuestion } from "../../src/config/validation";
import { reportData } from "../../src/reports/report-data";
import { runSummary } from "../../src/reports/terminal";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fingerprint, questionFingerprint } from "../../src/storage/fingerprints";
import { ReviewSnapshotStore } from "../../src/verification/ReviewSnapshotStore";
import { parseSubmission } from "../../src/verification/submission";
import { cli, fixture, response } from "../helpers";

async function reviewed(source = "func first():\n    return 1\n\nfunc second():\n    return 2\n") {
  const f = fixture();
  f.loaded.root = realpathSync(f.loaded.root);
  f.loaded.config.root = f.loaded.root;
  f.loaded.config.questions.methods = ["findings", "context", "documentation"].map((queue) =>
    parseQuestion({
      id: queue,
      type: "choice",
      context: "target",
      instructions: `Check ${queue}`,
      criteria: { problem: "Candidate", okay: "Clear" },
      flag: ["problem"],
      reviewQueues: { problem: queue },
    }),
  );
  f.write("example.gd", source);
  const plan = await f.plan();
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(plan, new RequestBatcher().batches(plan, f.loaded.config));
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  const command = (args: string[]) => cli(f.loaded.root, [...args, "--config", f.loaded.path]);
  const overview = await command(["report", "create"]);
  expect(overview.code).toBe(0);
  const snapshots = new ReviewSnapshotStore(f.loaded);
  const report = snapshots.read();
  if (!report.snapshotId) throw new Error("Missing snapshot");
  return { ...f, command, overview, snapshots, report, id: report.snapshotId };
}

function bundle(part: string) {
  const text = part.match(/^(`{3,})json\n([\s\S]*?)\n\1$/m)?.[2];
  if (!text) throw new Error("Missing handoff JSON");
  return JSON.parse(text);
}

test("report create is compact; listing and inspection retrieve shared evidence from its snapshot", async () => {
  const f = await reviewed();
  expect(f.overview.stdout).toContain("6 candidates");
  expect(f.overview.stdout).toContain("argus report batch 1");
  expect(f.overview.stdout).not.toContain("func first");
  const listed = await f.command(["report", "list", "--json"]);
  expect(listed.code).toBe(0);
  const index = JSON.parse(listed.stdout);
  expect(index.total).toBe(6);
  for (const queue of ["findings", "context", "documentation"]) {
    const selected = await f.command(["report", "list", "--queue", queue, "--json"]);
    expect(JSON.parse(selected.stdout).entries.map((entry: { queue: string }) => entry.queue)).toEqual([queue, queue]);
  }
  const shown = await f.command(["report", "show", index.entries[0].reviewId]);
  expect(shown.code).toBe(0);
  const detail = JSON.parse(shown.stdout);
  expect(f.overview.stdout).toContain(`Verdicts: ${detail.verdictFile}`);
  expect(detail.verdictFile).toEndWith(".verdicts.json");
  expect(detail.context.sourceId).toMatch(/^[a-f0-9]{64}$/);
  expect(shown.stdout).not.toContain("func first");
  const evidence = await f.command(["report", "evidence", detail.context.sourceId]);
  expect(evidence.code).toBe(0);
  expect(JSON.parse(evidence.stdout).source).toContain("func first");
  const saved = JSON.parse(readFileSync(f.snapshots.location(f.id), "utf8"));
  expect(Object.keys(saved.evidence)).toHaveLength(2);
  expect(Object.values(saved.report.contexts).every((context) => typeof context === "object")).toBe(true);
  const exported = await f.command(["report", "export"]);
  const data = bundle(exported.stdout);
  expect(data.version).toBe(2);
  expect(Object.keys(data.evidence)).toHaveLength(2);
  expect(data.checks).toHaveLength(6);
  for (const context of Object.values(data.contexts) as { sourceId: string }[])
    expect(data.evidence[context.sourceId]).toBeDefined();
  const htmlPath = join(f.directory, "snapshot.html");
  expect((await f.command(["report", "html", htmlPath])).code).toBe(0);
  expect(readFileSync(htmlPath, "utf8")).toContain("argus-report-data");
  expect((await f.command(["report", "html", htmlPath])).code).toBe(1);
});

test("snapshot batches survive partial imports and new snapshots omit unchanged settled findings", async () => {
  const f = await reviewed(
    `func first():\n    return "${"a".repeat(65000)}"\n\nfunc second():\n    return "${"b".repeat(65000)}"\n`,
  );
  const first = await f.command(["report", "batch", "1", "--snapshot", f.id]);
  const second = await f.command(["report", "batch", "2", "--snapshot", f.id]);
  expect(first.code).toBe(0);
  expect(second.code).toBe(0);
  const submission = parseSubmission(bundle(first.stdout).verdictTemplate);
  for (const verdict of submission.verdicts) {
    verdict.verdict = "false_positive";
    verdict.rationale = "Reviewed the supplied source and found the expected contract.";
  }
  const path = join(f.directory, "partial.json");
  writeFileSync(path, JSON.stringify(submission));
  expect((await f.command(["verify", "--import", path])).code).toBe(0);
  expect((await f.command(["report", "batch", "1", "--snapshot", f.id])).stdout).toBe(first.stdout);
  expect((await f.command(["report", "batch", "2", "--snapshot", f.id])).stdout).toBe(second.stdout);
  expect((await f.command(["report", "create"])).code).toBe(0);
  const latest = await f.command(["report", "list", "--json"]);
  const list = JSON.parse(latest.stdout);
  expect(list.total).toBe(6 - submission.verdicts.length);
  expect(list.snapshotId).not.toBe(f.id);
  const candidate = list.entries[0];
  const shown = JSON.parse((await f.command(["report", "show", candidate.reviewId])).stdout);
  const template = parseSubmission(JSON.parse(readFileSync(shown.verdictFile, "utf8")));
  expect(template.verdicts).toHaveLength(list.total);
  const firstVerdict = template.verdicts[0];
  const settledVerdict = submission.verdicts[0];
  if (!firstVerdict || !settledVerdict) throw new Error("Missing verdicts");
  firstVerdict.rationale = "Work in progress";
  writeFileSync(shown.verdictFile, JSON.stringify(template));
  expect(JSON.parse((await f.command(["report", "show", candidate.reviewId])).stdout).verdictFile).toBe(
    shown.verdictFile,
  );
  expect(JSON.parse(readFileSync(shown.verdictFile, "utf8"))).toEqual(template);
  const settled = JSON.parse((await f.command(["report", "show", settledVerdict.reviewId])).stdout);
  expect(settled.verdictFile).toBeUndefined();
  expect(settled.verdictTemplate.verdicts[0].reviewId).toBe(settledVerdict.reviewId);
  expect(JSON.parse((await f.command(["report", "list", "--json", "--include-verified"])).stdout).total).toBe(6);
  expect((await f.command(["report", "batch", "2", "--snapshot", f.id])).stdout).toBe(second.stdout);
});

test("run ends with a compact summary and a fresh report command, including after verdict imports", async () => {
  const f = await reviewed();
  const initial = await f.command(["run"]);
  expect(initial.code).toBe(0);
  expect(initial.stdout).toContain("6 review candidates");
  expect(initial.stdout).not.toContain("example.gd:");
  expect(
    runSummary(f.report, { config: "/project with spaces/config.json", path: "report.json", base: "HEAD~1" }),
  ).toContain("argus report create --config '/project with spaces/config.json' --base 'HEAD~1'");
  const submission = parseSubmission(bundle((await f.command(["report", "batch", "1"])).stdout).verdictTemplate);
  for (const verdict of submission.verdicts) {
    verdict.verdict = "false_positive";
    verdict.rationale = "The supplied source satisfies its contract.";
  }
  const path = join(f.directory, "settled.json");
  writeFileSync(path, JSON.stringify(submission));
  expect((await f.command(["verify", "--import", path])).code).toBe(0);
  const run = await f.command(["run"]);
  expect(run.code).toBe(0);
  expect(run.stdout).toContain("6 checked");
  expect(run.stdout).toContain("0 review candidates");
  expect(run.stdout).toContain("argus report create --config");
  expect(run.stdout).toContain(f.loaded.path);
  expect(run.stdout).not.toContain("example.gd:");
  expect(run.stdout.split("\n").length).toBeLessThan(10);
  const json = JSON.parse((await f.command(["run", "--json"])).stdout);
  expect(json.results).toHaveLength(6);
  expect(json.results.every((item) => item.verification?.verdict === "false_positive")).toBe(true);
});

test("retrieval uses saved evidence after edits; verification still rejects stale source", async () => {
  const f = await reviewed();
  const old = await f.command(["report", "batch", "1"]);
  const submission = parseSubmission(bundle(old.stdout).verdictTemplate);
  const item = submission.verdicts[0];
  if (!item) throw new Error("Missing verdict");
  item.verdict = "confirmed";
  item.rationale = "Reviewed this version of the method.";
  const path = join(f.directory, "verdict.json");
  writeFileSync(path, JSON.stringify(submission));
  f.write("example.gd", "func first():\n    return 999\n");
  expect((await f.command(["report", "batch", "1"])).stdout).toBe(old.stdout);
  const imported = await f.command(["verify", "--import", path]);
  expect(imported.code).toBe(1);
  expect(imported.stdout + imported.stderr).toContain("stale");
});

test("unknown IDs, malformed options and missing snapshots fail clearly", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  const missing = await cli(f.loaded.root, ["report", "list", "--config", f.loaded.path]);
  expect(missing.code).toBe(1);
  expect(missing.stdout + missing.stderr).toContain("Run 'argus report create' first");
  const reviewedFixture = await reviewed();
  for (const args of [
    ["show", "unknown"],
    ["evidence", "constructor"],
    ["list", "--queue", "unknown"],
    ["list", "--page", "0"],
    ["list", "--page", "999"],
    ["batch", "1.5"],
    ["batch", "999"],
    ["list", "--snapshot", "../outside"],
    ["list", "extra"],
    ["export", "--typo"],
  ])
    expect((await reviewedFixture.command(["report", ...args])).code).toBe(1);
});

test("snapshot reader supports previous inline evidence and detects tampered fragments", async () => {
  const f = await reviewed();
  const path = f.snapshots.location(f.id);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  const first = Object.keys(saved.evidence)[0];
  if (!first) throw new Error("Missing evidence");
  saved.evidence[first].source = "altered";
  writeFileSync(path, JSON.stringify(saved));
  expect(() => f.snapshots.read(f.id)).toThrow("Invalid snapshot evidence");
  const inline = { identity: saved.identity, report: { ...f.report, snapshotId: null } };
  writeFileSync(path, JSON.stringify(inline));
  expect(f.snapshots.read(f.id).results).toEqual(f.report.results);
});

test("queue metadata preserves evaluation and review identities, including existing stock configurations", async () => {
  const f = fixture();
  f.write("example.gd", "func value():\n    return 1\n");
  const before = await f.plan();
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      return response(payload);
    },
  }).run(before, new RequestBatcher().batches(before, f.loaded.config));
  const previous = reportData(before, 0);
  const question = f.loaded.config.questions.methods[0];
  if (!question) throw new Error("Missing question");
  const hash = questionFingerprint(question, f.loaded.config.model);
  question.reviewQueues = { matches: "documentation" };
  const next = reportData(await f.plan(), 0);
  expect(next.results[0]?.reviewId).toBe(previous.results[0]?.reviewId);
  expect(next.results[0]?.evaluation).toEqual(previous.results[0]?.evaluation);
  expect(questionFingerprint(question, f.loaded.config.model)).toBe(hash);
  expect(next.results[0]?.definitionId).toBe(fingerprint(question));
  expect(next.results[0]?.definitionId).not.toBe(previous.results[0]?.definitionId);
  expect(next.results[0]?.inputHash).toBe(previous.results[0]?.inputHash);
  expect(next.results[0]?.questionHash).toBe(previous.results[0]?.questionHash);
  delete question.reviewQueues;
  const loaded = parseConfig(f.loaded.config);
  expect(loaded.questions.methods[0]?.reviewQueues?.insufficient_context).toBe("context");
  expect(() => parseQuestion({ ...question, reviewQueues: { unknown: "context" } })).toThrow(
    "Unknown review queue choice",
  );
  expect(() => parseQuestion({ ...question, reviewQueues: { matches: "unknown" } })).toThrow("Unknown review queue");
});

test("custom context answers enter the review queue without being flagged", async () => {
  const f = await reviewed();
  for (const question of f.loaded.config.questions.methods) {
    question.flag = [];
    question.reviewQueues = { problem: "context" };
  }
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  expect((await f.command(["report", "create"])).code).toBe(0);
  const listed = await f.command(["report", "list", "--queue", "context", "--json"]);
  expect(JSON.parse(listed.stdout).total).toBe(6);
  expect(f.snapshots.read().summary.flagged).toBe(0);
});

test("candidate lists paginate without omissions or duplicates", async () => {
  const f = await reviewed(
    Array.from({ length: 17 }, (_, index) => `func value_${index}():\n    return ${index}\n`).join("\n"),
  );
  const first = JSON.parse((await f.command(["report", "list", "--json"])).stdout);
  const second = JSON.parse((await f.command(["report", "list", "--json", "--page", "2"])).stdout);
  expect(first.entries).toHaveLength(50);
  expect(second.entries).toHaveLength(1);
  expect(new Set([...first.entries, ...second.entries].map((entry) => entry.reviewId)).size).toBe(51);
});

test("empty snapshots and blocked checks have useful queue output", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--config", f.loaded.path])).code).toBe(0);
  const command = (args: string[]) => cli(f.loaded.root, ["report", ...args, "--config", f.loaded.path]);
  const empty = await command(["create"]);
  expect(empty.code).toBe(0);
  expect(empty.stdout).toContain("0 candidates · 0 batches");
  expect(empty.stdout).not.toContain("argus report batch 1");
  expect((await command(["export"])).stdout).toContain("No unverified review candidates");
  f.loaded.config.maxRequestBytes = 2000;
  f.write("example.gd", `func large():\n    return "${"x".repeat(3000)}"\n`);
  writeFileSync(f.loaded.path, JSON.stringify(f.loaded.config));
  expect((await command(["create"])).code).toBe(0);
  const context = JSON.parse((await command(["list", "--queue", "context", "--json"])).stdout);
  expect(context.entries).toHaveLength(1);
  expect(context.entries[0].answer).toBe("blocked");
  const run = await cli(f.loaded.root, ["run", "--config", f.loaded.path]);
  expect(run.code).toBe(1);
  expect(run.stdout).toContain("1 blocked");
  expect(run.stdout).toContain("1 review candidates");
  expect(run.stdout).not.toContain("example.gd:");
  const check = await cli(f.loaded.root, ["check", "--config", f.loaded.path]);
  expect(check.code).toBe(1);
  expect(check.stdout).toContain("example.gd:");
});
