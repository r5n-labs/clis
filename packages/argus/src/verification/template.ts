import { REVIEW_PROTOCOL } from "../reports/review-protocol";
import type { VerificationSubmission } from "./submission";

export function verdictTemplate(snapshotId: string, reviewIds: string[]): VerificationSubmission {
  return {
    version: 2,
    snapshotId,
    reviewer: { model: "unknown", promptVersion: REVIEW_PROTOCOL },
    verdicts: reviewIds.map((reviewId) => ({ reviewId, verdict: "", rationale: "", evidence: [] })),
  };
}
