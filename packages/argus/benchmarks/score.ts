import type { Question } from "../src/domain/question";
import type { ApiResponse } from "../src/providers/jev/schemas";
import { selectCandidate } from "../src/reports/selection";
import type { BenchmarkCase } from "./cases";

export function scoreCases(rows: { example: BenchmarkCase; question: Question; response?: ApiResponse }[]) {
  const results = rows.map(({ example, question, response }) => {
    const answer = response?.answers.q0;
    const selected = selectCandidate(question, answer);
    return {
      id: example.id,
      expected: example.expected,
      expectedCandidate: example.candidate,
      rationale: example.rationale,
      actual: answer?.choice ?? null,
      correct: answer ? answer.choice === example.expected : null,
      candidate: answer ? selected.flagged : null,
      concernProbability: answer ? selected.concernProbability : null,
      usage: response?.usage ?? null,
    };
  });
  const evaluated = results.filter((row) => row.actual !== null);
  const positives = evaluated.filter((row) => row.expectedCandidate);
  const selected = evaluated.filter((row) => row.candidate);
  const truePositives = selected.filter((row) => row.expectedCandidate);
  return {
    total: results.length,
    evaluated: evaluated.length,
    missing: results.length - evaluated.length,
    candidateRecall: positives.length ? truePositives.length / positives.length : null,
    candidatePrecisionAgainstLabels: selected.length ? truePositives.length / selected.length : null,
    labelAccuracy: evaluated.length ? evaluated.filter((row) => row.correct).length / evaluated.length : null,
    concernBrierScore: evaluated.length
      ? evaluated.reduce((sum, row) => sum + ((row.concernProbability ?? 0) - Number(row.expectedCandidate)) ** 2, 0) /
        evaluated.length
      : null,
    selectedInputTokens: selected.reduce((sum, row) => sum + (row.usage?.input_tokens ?? 0), 0),
    limitation:
      "Small synthetic, rationale-labelled regression set. Partial runs are not comparable to full runs. This does not establish population calibration or downstream LLM acceptance. Labels should be independently reviewed before tuning thresholds.",
    results,
  };
}
