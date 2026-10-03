import type { Question } from "../domain/question";
import type { ReviewContext, ReviewPlan } from "../domain/review-plan";
import { fingerprint } from "../storage/fingerprints";
import type { Verification } from "../verification/schema";
import { REVIEW_PROTOCOL } from "./review-protocol";
import { selectCandidate } from "./selection";
import { verificationSummary } from "./verification-summary";

export function reportData(plan: ReviewPlan, requests: number) {
  const contexts: Record<string, ReviewContext> = {};
  const questions: Record<string, Question> = {};
  const results = plan.items.map((item) => {
    const contextId = fingerprint(item.context);
    contexts[contextId] ??= structuredClone(item.context);
    const { reviewQueues: _reviewQueues, ...definition } = item.question;
    const definitionId = fingerprint(item.question);
    questions[definitionId] ??= structuredClone(item.question);
    return {
      reviewId: fingerprint({
        protocol: REVIEW_PROTOCOL,
        input: item.inputHash,
        definitionId: fingerprint(definition),
        evaluation: item.evaluation ?? null,
      }),
      definitionId,
      instructions: item.apiQuestion.instructions,
      verification: null as Verification | null,
      path: item.target.path,
      line: item.target.line,
      target: `${item.target.owner}.${item.target.name}`,
      group: item.target.group,
      question: item.question.id,
      inputHash: item.inputHash,
      questionHash: item.questionHash,
      contextId,
      status: item.evaluation ? "checked" : item.blocked ? "blocked" : "pending",
      reason: item.blocked ?? null,
      contextReview: {
        expanded: item.expanded ?? false,
        note: item.contextNote ?? null,
        unresolved: item.context.unresolved ?? [],
        notes: item.context.notes ?? [],
      },
      ...selectCandidate(item.question, item.evaluation?.answer),
      evaluation: item.evaluation ?? null,
    };
  });
  return {
    formatVersion: 2,
    snapshotId: null as string | null,
    verificationSummary: verificationSummary([]),
    root: plan.root,
    model: plan.model,
    generatedAt: new Date().toISOString(),
    summary: {
      files: plan.files,
      targets: plan.targets,
      questions: results.length,
      checked: results.filter((item) => item.status === "checked").length,
      pending: results.filter((item) => item.status === "pending").length,
      blocked: results.filter((item) => item.status === "blocked").length,
      flagged: results.filter((item) => item.flagged).length,
      requests,
    },
    results,
    contexts,
    questions,
  };
}

export type Report = ReturnType<typeof reportData> & { verdictFile?: string };
