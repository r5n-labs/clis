import { Exit } from "@r5n/cli-core";
import { object } from "banditypes";
import { closed, textValue } from "../config/validation";

export const VERDICTS = ["confirmed", "false_positive", "deferred", "uncertain"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Evidence = { path: string; sha256: string };
export type VerificationResult = { reviewId: string; verdict: Verdict; rationale: string; evidence: Evidence[] };
export type Reviewer = { model: string; promptVersion: string };
export type Verification = VerificationResult & { reviewer: Reviewer; verifiedAt: string };
export type VerificationImport = { version: number; reviewer: Reviewer; verdicts: VerificationResult[] };

export function parseReviewer(value: unknown): Reviewer {
  return object<Reviewer>({ model: textValue, promptVersion: textValue })(
    closed(value, "reviewer", ["model", "promptVersion"]),
  );
}

export function hashValue(value: unknown): string {
  const hash = textValue(value);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Exit("Expected a SHA-256 fingerprint");
  return hash;
}

export function parseVerificationImport(value: unknown): VerificationImport {
  return object<VerificationImport>({
    version: (v) => {
      if (v !== 1) throw new Exit("Expected verification version 1");
      return v;
    },
    reviewer: parseReviewer,
    verdicts: (v) => {
      if (!Array.isArray(v)) throw new Exit("verdicts must be an array");
      const verdicts = v.map(parseVerdict);
      if (new Set(verdicts.map((item) => item.reviewId)).size !== verdicts.length)
        throw new Exit("Duplicate review ID");
      return verdicts;
    },
  })(closed(value, "verification", ["version", "reviewer", "verdicts"]));
}

export function parseVerdict(value: unknown): VerificationResult {
  return object<VerificationResult>({
    reviewId: hashValue,
    verdict: (v) => {
      const verdict = VERDICTS.find((entry) => entry === v);
      if (!verdict) throw new Exit("Unknown verification verdict");
      return verdict;
    },
    rationale: textValue,
    evidence: (v) => {
      if (!Array.isArray(v)) throw new Exit("evidence must list additional files inspected by the reviewer");
      return v.map((entry) =>
        object<Evidence>({ path: textValue, sha256: hashValue })(closed(entry, "evidence", ["path", "sha256"])),
      );
    },
  })(closed(value, "verdict", ["reviewId", "verdict", "rationale", "evidence"]));
}
