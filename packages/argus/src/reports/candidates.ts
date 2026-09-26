import type { Report } from "./report-data";

export function isReviewCandidate(
  item: Report["results"][number],
  questions: Report["questions"],
  includeVerified = false,
): boolean {
  const choice = item.evaluation?.answer.choice;
  const candidate =
    item.flagged ||
    item.status === "blocked" ||
    choice === "insufficient_context" ||
    (!!choice && questions[item.definitionId]?.reviewQueues?.[choice] === "context");
  const settled = item.verification && item.verification.verdict !== "uncertain";
  return candidate && (includeVerified || !settled);
}
