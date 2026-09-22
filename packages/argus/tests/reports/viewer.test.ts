import { expect, test } from "bun:test";
import { htmlReport } from "../../src/reports/html";
import { reportData } from "../../src/reports/report-data";
import type { Result } from "../../src/reports/ui/select-results";
import { DEFAULT_FILTERS, DEFAULT_SORT, selectResults } from "../../src/reports/ui/select-results";
import { fixture } from "../helpers";

function result(options: {
  path: string;
  question?: string;
  confidence?: number;
  flagged?: boolean;
  status?: string;
  choice?: string;
}): Result {
  const status = options.status ?? "checked";
  return {
    reviewId: "review",
    definitionId: "definition",
    instructions: "Example question",
    verification: null,
    concernProbability: options.flagged ? 1 : 0,
    selectionReason: options.flagged ? "Flagged winning answer" : null,
    path: options.path,
    line: 1,
    target: `${options.path}.value`,
    group: "methods",
    question: options.question ?? "naming-accuracy",
    inputHash: "a",
    questionHash: "b",
    contextId: "preview",
    contextReview: { expanded: false, note: null, unresolved: [], notes: [] },
    status,
    reason: status === "blocked" ? "Context too large" : null,
    flagged: options.flagged ?? false,
    evaluation:
      status === "checked"
        ? {
            version: 1,
            inputHash: "a",
            questionHash: "b",
            targetId: "value",
            questionId: "naming-accuracy",
            model: "test",
            evaluatedAt: "2026-09-18T00:00:00.000Z",
            requestId: "c",
            answer: {
              type: "choice",
              choice: options.choice ?? "matches",
              confidence: options.confidence ?? 1,
              probabilities: { matches: 1, misleading: 0 },
            },
          }
        : null,
  };
}

test("filters combine categories, status, result, search and confidence", () => {
  const results = [
    result({
      path: "scripts/unit.gd",
      question: "naming-accuracy",
      flagged: true,
      confidence: 0.85,
      choice: "misleading",
    }),
    result({ path: "scripts/unit.gd", question: "comments", flagged: true, confidence: 0.95, choice: "misleading" }),
    result({ path: "tests/test_unit.gd", confidence: 0.4, flagged: true, choice: "misleading" }),
    result({ path: "scripts/unit.gd", status: "pending" }),
  ];
  const filtered = selectResults(
    results,
    {
      ...DEFAULT_FILTERS,
      category: "naming-accuracy",
      search: "SCRIPTS/UNIT",
      status: "flagged",
      answer: "misleading",
      minConfidence: 0.8,
    },
    DEFAULT_SORT,
  );
  expect(filtered).toHaveLength(1);
  expect(filtered[0]?.evaluation?.answer.confidence).toBe(0.85);
  expect(selectResults(results, { ...DEFAULT_FILTERS, minConfidence: 0.9 }, DEFAULT_SORT)).toHaveLength(1);
  expect(selectResults(results, { ...DEFAULT_FILTERS, search: "nothing-matches" }, DEFAULT_SORT)).toHaveLength(0);
});

test("sorts confidence numerically in both directions with unevaluated rows last", () => {
  const results = [
    result({ path: "high", confidence: 0.95 }),
    result({ path: "pending", status: "pending" }),
    result({ path: "low", confidence: 0.2 }),
  ];
  expect(
    selectResults(results, DEFAULT_FILTERS, { key: "confidence", direction: "asc" }).map((item) => item.path),
  ).toEqual(["low", "high", "pending"]);
  expect(
    selectResults(results, DEFAULT_FILTERS, { key: "confidence", direction: "desc" }).map((item) => item.path),
  ).toEqual(["high", "low", "pending"]);
  expect(results.map((item) => item.path)).toEqual(["high", "pending", "low"]);
});

test("default ordering highlights findings, blocked work and then confident checked results", () => {
  const results = [
    result({ path: "checked" }),
    result({ path: "pending", status: "pending" }),
    result({ path: "blocked", status: "blocked" }),
    result({ path: "flagged", flagged: true, confidence: 0.2 }),
  ];
  expect(selectResults(results, DEFAULT_FILTERS, DEFAULT_SORT).map((item) => item.path)).toEqual([
    "flagged",
    "blocked",
    "checked",
    "pending",
  ]);
  expect(selectResults(results, { ...DEFAULT_FILTERS, status: "checked" }, DEFAULT_SORT)).toHaveLength(2);
  expect(selectResults(results, { ...DEFAULT_FILTERS, status: "blocked" }, DEFAULT_SORT)).toHaveLength(1);
});

test("natural path ordering preserves result identities", () => {
  const results = [result({ path: "file10.gd" }), result({ path: "file2.gd" }), result({ path: "file1.gd" })];
  expect(selectResults(results, DEFAULT_FILTERS, { key: "path", direction: "asc" }).map((item) => item.path)).toEqual([
    "file1.gd",
    "file2.gd",
    "file10.gd",
  ]);
});

test("standalone HTML embeds the viewer and safely round-trips hostile report strings", async () => {
  const f = fixture();
  const report = reportData(await f.plan(), 0);
  report.root = '</script><img src=x onerror="alert(1)">\u2028&';
  const html = await htmlReport(report);
  const embedded = /<script id="argus-report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(embedded).toBeDefined();
  expect(JSON.parse(embedded ?? "null")).toEqual(report);
  expect(html).not.toContain("<img src=x");
  expect(html).not.toMatch(/<script[^>]+src=/);
  expect(html).not.toMatch(/<link[^>]+href=/);
  expect(html).toContain("default-src 'none'");
  expect(html).toContain('id="root"');
});
