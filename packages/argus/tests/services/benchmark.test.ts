import { expect, test } from "bun:test";
import { CASES } from "../../benchmarks/cases";
import { scoreCases } from "../../benchmarks/score";
import { presetQuestions } from "../../src/presets";
import { response } from "../helpers";

test("benchmark detects missed candidates and false positives, and never scores missing runs as successes", () => {
  const rows = CASES.map((example) => {
    const question = presetQuestions([example.preset])[0]?.question;
    if (!question) throw new Error("Missing preset");
    expect(question.criteria[example.expected]).toBeDefined();
    const result = response({ model: "fixture", state: example.context, questions: { q0: question } });
    const answer = result.answers.q0;
    if (!answer) throw new Error("Missing answer");
    answer.choice = example.expected;
    answer.probabilities = Object.fromEntries(
      Object.keys(question.criteria).map((choice) => [choice, Number(choice === example.expected)]),
    );
    return { example, question, response: result };
  });
  expect(scoreCases(rows)).toMatchObject({
    candidateRecall: 1,
    candidatePrecisionAgainstLabels: 1,
    labelAccuracy: 1,
    concernBrierScore: 0,
  });
  const missed = rows.find((row) => row.example.id === "research-spending");
  const answer = missed?.response.answers.q0;
  if (!answer) throw new Error("Missing candidate");
  answer.choice = "verified";
  answer.probabilities = { verified: 1, unverified_promise: 0, insufficient_context: 0 };
  expect(scoreCases(rows).candidateRecall).toBeLessThan(1);
  const falsePositive = rows.find((row) => row.example.id === "base-hook")?.response.answers.q0;
  if (!falsePositive) throw new Error("Missing negative example");
  falsePositive.choice = "misleading";
  falsePositive.probabilities = Object.fromEntries(
    Object.keys(falsePositive.probabilities).map((choice) => [choice, Number(choice === "misleading")]),
  );
  expect(scoreCases(rows).candidatePrecisionAgainstLabels).toBeLessThan(1);
  expect(scoreCases(rows.map((row) => ({ ...row, response: undefined })))).toMatchObject({
    evaluated: 0,
    candidateRecall: null,
    labelAccuracy: null,
  });
});
