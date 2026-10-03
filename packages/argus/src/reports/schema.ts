import { Exit } from "@r5n/cli-core";
import { array, boolean, number, object, string } from "banditypes";
import { parseQuestion, record, strings, textValue } from "../config/validation";
import { GROUPS } from "../constants";
import type { ReviewContext } from "../domain/review-plan";
import { parseEvaluation } from "../storage/EvaluationStore";
import { parseReviewer, parseVerdict, type Verification } from "../verification/schema";
import type { Report } from "./report-data";

function dictionary<T>(value: unknown, parse: (entry: unknown) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record(value, "dictionary")).map(([key, entry]) => [key, parse(entry)]));
}

const nullable =
  <T>(parse: (value: unknown) => T) =>
  (value: unknown): T | null =>
    value === null ? null : parse(value);
const optional =
  <T>(parse: (value: unknown) => T) =>
  (value: unknown): T | undefined =>
    value === undefined ? undefined : parse(value);
const unresolved = array(object({ path: textValue, expressions: strings }));

export const parseContext = object<ReviewContext>({
  language: textValue,
  path: textValue,
  source: string(),
  related: array(object({ path: textValue, source: string() })),
  unresolved: optional(unresolved),
  referenceScope: optional(textValue),
  notes: optional(strings),
});

function parseVerification(value: unknown): Verification {
  const raw = record(value, "verification");
  const { reviewer, verifiedAt, ...verdict } = raw;
  return { ...parseVerdict(verdict), reviewer: parseReviewer(reviewer), verifiedAt: textValue(verifiedAt) };
}

const parseResult = object<Report["results"][number]>({
  reviewId: textValue,
  definitionId: textValue,
  instructions: textValue,
  verification: nullable(parseVerification),
  path: textValue,
  line: number(),
  target: textValue,
  group: (v) => {
    const group = GROUPS.find((entry) => entry === v);
    if (!group) throw new Exit("Invalid report target group");
    return group;
  },
  question: textValue,
  inputHash: textValue,
  questionHash: textValue,
  contextId: textValue,
  status: textValue,
  reason: nullable(string()),
  contextReview: object({ expanded: boolean(), note: nullable(string()), unresolved, notes: strings }),
  flagged: boolean(),
  concernProbability: number(),
  selectionReason: nullable(string()),
  evaluation: nullable(parseEvaluation),
});

export function parseReport(value: unknown): Report {
  const report = object<Report>({
    formatVersion: number(),
    snapshotId: nullable(textValue),
    verdictFile: optional(textValue),
    root: textValue,
    model: textValue,
    generatedAt: textValue,
    verificationSummary: object({
      confirmed: number(),
      deferred: number(),
      falsePositives: number(),
      uncertain: number(),
      total: number(),
      acceptanceRate: nullable(number()),
    }),
    summary: object({
      files: number(),
      targets: number(),
      questions: number(),
      checked: number(),
      pending: number(),
      blocked: number(),
      flagged: number(),
      requests: number(),
    }),
    results: array(parseResult),
    contexts: (v) => dictionary(v, parseContext),
    questions: (v) => dictionary(v, parseQuestion),
  })(value);
  if (report.formatVersion !== 2) throw new Exit("Unsupported report format; export a fresh report");
  for (const item of report.results)
    if (!Object.hasOwn(report.contexts, item.contextId) || !Object.hasOwn(report.questions, item.definitionId))
      throw new Exit("Saved report references missing context or questions");
  return report;
}
