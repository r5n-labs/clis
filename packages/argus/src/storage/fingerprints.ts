import { createHash } from "node:crypto";
import { CONTEXT_VERSION } from "../constants";
import type { Question } from "../domain/question";
import type { ReviewContext } from "../domain/review-plan";
import type { SourceTarget } from "../domain/source-target";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Cannot fingerprint undefined");
  return encoded;
}

export function checksum(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
export function fingerprint(value: unknown): string {
  return checksum(canonical(value));
}

export function questionFingerprint(question: Question, model: string): string {
  return fingerprint({
    version: CONTEXT_VERSION,
    model,
    type: question.type,
    instructions: question.instructions,
    criteria: question.criteria,
    context: question.context,
  });
}

export function inputFingerprint(root: string, target: SourceTarget, context: ReviewContext): string {
  return fingerprint({ root, target: target.id, input: context });
}
