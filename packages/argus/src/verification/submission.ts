import { Exit } from "@r5n/cli-core";
import { object, string } from "banditypes";
import { closed, strings } from "../config/validation";
import { REVIEW_PROTOCOL } from "../reports/review-protocol";
import { hashValue, parseReviewer, type Reviewer, VERDICTS, type Verdict } from "./schema";

export type SubmittedVerdict = { reviewId: string; verdict: Verdict | ""; rationale: string; evidence: string[] };
export type VerificationSubmission = {
  version: 2;
  snapshotId: string;
  reviewer: Reviewer;
  verdicts: SubmittedVerdict[];
};

export function parseSubmission(value: unknown): VerificationSubmission {
  return object<VerificationSubmission>({
    version: (v) => {
      if (v !== 2) throw new Exit("Expected verification submission version 2");
      return v;
    },
    snapshotId: hashValue,
    reviewer: (v) => parseReviewer(v ?? { model: "unknown", promptVersion: REVIEW_PROTOCOL }),
    verdicts: (v) => {
      if (!Array.isArray(v)) throw new Exit("verdicts must be an array");
      const verdicts = v.map(parseSubmittedVerdict);
      if (new Set(verdicts.map((item) => item.reviewId)).size !== verdicts.length)
        throw new Exit("Duplicate review ID");
      return verdicts;
    },
  })(closed(value, "verification submission", ["version", "snapshotId", "reviewer", "verdicts"]));
}

function parseSubmittedVerdict(value: unknown): SubmittedVerdict {
  const item = object<SubmittedVerdict>({
    reviewId: hashValue,
    verdict: (v) => {
      if (v === "") return v;
      const verdict = VERDICTS.find((entry) => entry === v);
      if (!verdict) throw new Exit("Unknown verification verdict");
      return verdict;
    },
    rationale: string(),
    evidence: strings,
  })(closed(value, "verdict", ["reviewId", "verdict", "rationale", "evidence"]));
  if (item.verdict && !item.rationale.trim()) throw new Exit(`Missing rationale for ${item.reviewId}`);
  if (!item.verdict && (item.rationale.trim() || item.evidence.length))
    throw new Exit(`Missing verdict for ${item.reviewId}; leave all fields blank to skip a check`);
  return item;
}
