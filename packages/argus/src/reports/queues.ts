import type { ReviewQueue } from "../domain/review-queue";
import type { Report } from "./report-data";

export function reviewQueue(report: Report, item: Report["results"][number]): ReviewQueue {
  if (item.status === "blocked" || item.status === "pending") return "context";
  const choice = item.evaluation?.answer.choice;
  return (choice && report.questions[item.definitionId]?.reviewQueues?.[choice]) || "findings";
}
