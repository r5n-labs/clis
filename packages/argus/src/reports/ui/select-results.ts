import type { Report } from "../report-data";

export type Result = Report["results"][number];
export type StatusFilter = "all" | "flagged" | "checked" | "pending" | "blocked";
export type Filters = {
  search: string;
  category: string;
  group: string;
  answer: string;
  status: StatusFilter;
  minConfidence: number;
};
export type SortKey = "priority" | "target" | "path" | "question" | "answer" | "confidence" | "status";
export type Sort = { key: SortKey; direction: "asc" | "desc" };
export const DEFAULT_FILTERS: Filters = {
  search: "",
  category: "",
  group: "",
  answer: "",
  status: "all",
  minConfidence: 0,
};
export const DEFAULT_SORT: Sort = { key: "priority", direction: "asc" };
export const PAGE_SIZE = 50;
export const PERCENT = 100;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function selectResults(results: readonly Result[], filters: Filters, sort: Sort): Result[] {
  const query = filters.search.trim().toLowerCase();
  return results
    .filter((item) => {
      const answer = item.evaluation?.answer;
      if (filters.category && item.question !== filters.category) return false;
      if (filters.group && item.group !== filters.group) return false;
      if (filters.answer && answer?.choice !== filters.answer) return false;
      if (filters.status === "flagged" && !item.flagged) return false;
      if (["checked", "pending", "blocked"].includes(filters.status) && item.status !== filters.status) return false;
      if (filters.minConfidence > 0 && (answer?.confidence === undefined || answer.confidence < filters.minConfidence))
        return false;
      return (
        !query ||
        [
          item.path,
          item.target,
          item.question,
          item.group,
          item.status,
          answer?.choice,
          item.reason,
          item.verification?.verdict,
          item.verification?.rationale,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      );
    })
    .sort(
      (left, right) =>
        compare(left, right, sort) ||
        collator.compare(left.path, right.path) ||
        left.line - right.line ||
        collator.compare(left.question, right.question),
    );
}

function compare(left: Result, right: Result, sort: Sort): number {
  const direction = sort.direction === "asc" ? 1 : -1;
  if (sort.key === "priority")
    return (
      Number(right.flagged) - Number(left.flagged) ||
      Number(right.status === "blocked") - Number(left.status === "blocked") ||
      (right.evaluation?.answer.confidence ?? 0) - (left.evaluation?.answer.confidence ?? 0)
    );
  if (sort.key === "confidence") {
    const a = left.evaluation?.answer.confidence;
    const b = right.evaluation?.answer.confidence;
    if (a === undefined) return b === undefined ? 0 : 1;
    if (b === undefined) return -1;
    return (a - b) * direction;
  }
  const a = sort.key === "answer" ? (left.evaluation?.answer.choice ?? "") : left[sort.key];
  const b = sort.key === "answer" ? (right.evaluation?.answer.choice ?? "") : right[sort.key];
  return collator.compare(a, b) * direction;
}

export function label(value: string): string {
  const text = value.replaceAll(/[-_]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function confidence(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * PERCENT)}%`;
}

export function resultKey(item: Result): string {
  return `${item.group}:${item.path}:${item.target}:${item.question}`;
}
