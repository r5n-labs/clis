import { isDeepStrictEqual } from "node:util";
import type { Question } from "../domain/question";
import type { ReviewQueue } from "../domain/review-queue";
import { PRESETS } from "./catalog";

export function withReviewQueues(question: Question): Question {
  if (question.reviewQueues !== undefined) return question;
  const preset = Object.values(PRESETS)
    .map((entry) => entry.question)
    .find(
      (entry) =>
        entry.id === question.id &&
        entry.instructions === question.instructions &&
        isDeepStrictEqual(entry.criteria, question.criteria),
    );
  return preset ? { ...question, reviewQueues: { ...preset.reviewQueues } as Record<string, ReviewQueue> } : question;
}
