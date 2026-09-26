import type { Verification } from "../verification/schema";

export function verificationSummary(verifications: (Verification | null)[]) {
  const count = (verdict: Verification["verdict"]) => verifications.filter((item) => item?.verdict === verdict).length;
  const confirmed = count("confirmed");
  const deferred = count("deferred");
  const falsePositives = count("false_positive");
  const uncertain = count("uncertain");
  const settled = confirmed + deferred + falsePositives;
  return {
    confirmed,
    deferred,
    falsePositives,
    uncertain,
    total: settled + uncertain,
    acceptanceRate: settled ? (confirmed + deferred) / settled : null,
  };
}
