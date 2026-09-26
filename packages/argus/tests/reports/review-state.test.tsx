import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { parseConfig, parseQuestion } from "../../src/config/validation";
import { reviewCandidates } from "../../src/reports/llm";
import { reviewQueue } from "../../src/reports/queues";
import { ReviewCatalogue } from "../../src/reports/ReviewCatalogue";
import { reportData } from "../../src/reports/report-data";
import { parseReport } from "../../src/reports/schema";
import { ReportApp } from "../../src/reports/ui/ReportApp";
import { ResultDetails } from "../../src/reports/ui/ResultDetails";
import { DEFAULT_FILTERS, DEFAULT_SORT, selectResults } from "../../src/reports/ui/select-results";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { ReviewSnapshotStore } from "../../src/verification/ReviewSnapshotStore";
import { VerificationStore } from "../../src/verification/VerificationStore";
import { fixture, response } from "../helpers";

async function evaluated(f: ReturnType<typeof fixture>) {
  const plan = await f.plan();
  await new ReviewRunner(f.store, { evaluate: async (payload) => response(payload) }).run(
    plan,
    new RequestBatcher().batches(plan, f.loaded.config),
  );
  return { plan, report: reportData(plan, 0) };
}

function verify(
  f: ReturnType<typeof fixture>,
  report: ReturnType<typeof reportData>,
  reviewId: string,
  verdict: string,
) {
  const store = new VerificationStore(f.loaded.root, join(f.loaded.stateDir, "verifications"));
  store.import(
    {
      version: 1,
      reviewer: { model: "fixture-reviewer", promptVersion: "v1" },
      verdicts: [{ reviewId, verdict, rationale: "Evidence establishes the contract", evidence: [] }],
    },
    report,
  );
  store.apply(report);
}

test("group-specific question queues survive dictionary deduplication and snapshot round-trips", async () => {
  const f = fixture();
  f.loaded.root = realpathSync(f.loaded.root);
  f.loaded.config.root = f.loaded.root;
  const question = parseQuestion({
    id: "shared",
    type: "choice",
    context: "target",
    instructions: "Shared instructions",
    criteria: { missing: "Missing evidence", clear: "Clear" },
    flag: [],
    reviewQueues: { missing: "findings" },
  });
  f.loaded.config.questions.methods = [question];
  f.loaded.config.questions.files = [{ ...question, reviewQueues: { missing: "context" } }];
  expect(parseConfig(f.loaded.config).questions.files[0]?.reviewQueues?.missing).toBe("context");
  f.write("value.ts", "export function value() { return 1; }");
  const { plan } = await evaluated(f);
  for (const items of [plan.items, [...plan.items].reverse()]) {
    const report = parseReport(reportData({ ...plan, items }, 0));
    expect(Object.keys(report.questions)).toHaveLength(2);
    expect(Object.fromEntries(report.results.map((item) => [item.group, reviewQueue(report, item)]))).toEqual({
      methods: "findings",
      files: "context",
    });
    expect(reviewCandidates(report).map((item) => item.group)).toEqual(["files"]);
    expect(new ReviewCatalogue(report).candidates("context")).toHaveLength(1);
    const snapshots = new ReviewSnapshotStore(f.loaded);
    snapshots.save(report, snapshots.captureFiles());
    const template = JSON.parse(readFileSync(snapshots.saveTemplate(report), "utf8"));
    expect(template.verdicts.map((item: { reviewId: string }) => item.reviewId)).toEqual(
      reviewCandidates(snapshots.read(report.snapshotId ?? undefined)).map((item) => item.reviewId),
    );
    expect(template.verdicts).toHaveLength(1);
  }
});

test("Needs review uses the same outstanding candidates as handoff, including custom context answers", async () => {
  const f = fixture();
  const cases = ["flagged", "settled", "insufficient", "custom", "blocked", "uncertain", "pending", "clear"];
  f.write("value.ts", cases.map((name) => `export function ${name}() { return 1; }`).join("\n"));
  f.loaded.config.questions.methods = [
    parseQuestion({
      id: "review",
      type: "choice",
      context: "target",
      instructions: "Check the contract",
      criteria: { wrong: "Wrong", insufficient_context: "Unknown", custom: "Inspect context", clear: "Clear" },
      flag: ["wrong"],
      reviewQueues: { custom: "context" },
    }),
  ];
  const { plan } = await evaluated(f);
  for (const item of plan.items) {
    const name = item.target.name;
    if (name === "pending" || name === "blocked") {
      item.evaluation = undefined;
      if (name === "blocked") item.blocked = "Context too large";
      continue;
    }
    if (!item.evaluation) throw new Error("Missing evaluation");
    const choice =
      name === "insufficient" ? "insufficient_context" : name === "custom" || name === "clear" ? name : "wrong";
    item.evaluation.answer = {
      type: "choice",
      choice,
      confidence: 1,
      probabilities: Object.fromEntries(
        Object.keys(item.question.criteria).map((key) => [key, Number(key === choice)]),
      ),
    };
  }
  const report = reportData(plan, 0);
  for (const name of ["settled", "uncertain"]) {
    const item = report.results.find((entry) => entry.target.endsWith(`.${name}`));
    if (!item) throw new Error("Missing verification target");
    verify(f, report, item.reviewId, name === "settled" ? "false_positive" : "uncertain");
  }
  const selected = selectResults(
    report.results,
    { ...DEFAULT_FILTERS, status: "review" },
    DEFAULT_SORT,
    report.questions,
  );
  expect(selected.map((item) => item.reviewId).sort()).toEqual(
    reviewCandidates(report)
      .map((item) => item.reviewId)
      .sort(),
  );
  expect(selected.map((item) => item.target.split(".").at(-1)).sort()).toEqual([
    "blocked",
    "custom",
    "flagged",
    "insufficient",
    "uncertain",
  ]);
  const ordered = selectResults(report.results, DEFAULT_FILTERS, DEFAULT_SORT, report.questions);
  expect(
    ordered
      .slice(0, selected.length)
      .map((item) => item.reviewId)
      .sort(),
  ).toEqual(selected.map((item) => item.reviewId).sort());
  expect(
    selectResults(report.results, { ...DEFAULT_FILTERS, status: "flagged" }, DEFAULT_SORT, report.questions),
  ).toHaveLength(3);
  expect(report.summary.flagged).toBe(3);
  const html = renderToStaticMarkup(<ReportApp report={report} />);
  expect(html).toMatch(/value="review"[^>]*>[\s\S]*?<strong>5<\/strong>/);
  expect(html).toContain('<option value="flagged">Flagged</option>');
});

test.each(["pending", "blocked"])(
  "%s details retain instructions and imported verdict without a model answer",
  async (status) => {
    const f = fixture();
    f.write("value.ts", "export function value() { return 1; }");
    f.loaded.config.questions.methods = [
      parseQuestion({
        id: "question",
        type: "choice",
        context: "target",
        instructions: "Exact question instructions",
        criteria: { wrong: "Exact wrong criterion", clear: "Clear" },
      }),
    ];
    if (status === "blocked") f.loaded.config.maxRequestBytes = 1;
    const report = reportData(await f.plan(), 0);
    const item = report.results[0];
    if (!item) throw new Error("Missing result");
    expect(item.status).toBe(status);
    verify(f, report, item.reviewId, "confirmed");
    for (const providedReport of [report, undefined]) {
      const html = renderToStaticMarkup(
        <ResultDetails context={report.contexts[item.contextId]} item={item} report={providedReport} />,
      );
      expect(html).toContain("Exact question instructions");
      expect(html).toContain("Evidence establishes the contract");
      expect(html).toContain("fixture-reviewer");
      expect(html).toContain("return");
      if (providedReport) expect(html).toContain("Exact wrong criterion");
      expect(html).not.toContain("Answer distribution");
      expect(html).not.toContain("Concern probability");
      expect(html).not.toContain("Not selected as a candidate");
      expect(html).not.toContain("Cache fingerprints");
    }
  },
);
