import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Exit } from "@r5n/cli-core";
import { object } from "banditypes";
import { readJson } from "../config/loader";
import { closed, textValue } from "../config/validation";
import type { Report } from "../reports/report-data";
import { verificationSummary } from "../reports/verification-summary";
import { writeJson } from "../storage/EvaluationStore";
import { checksum } from "../storage/fingerprints";
import {
  type Evidence,
  hashValue,
  parseVerificationImport,
  type Verification,
  type VerificationImport,
} from "./schema";

export class VerificationStore {
  constructor(
    private readonly root: string,
    private readonly directory: string,
  ) {}

  apply(report: Report): void {
    for (const item of report.results) item.verification = this.find(item.reviewId);
    report.verificationSummary = verificationSummary(report.results.map((item) => item.verification));
  }

  import(value: unknown, report: Report): number {
    const review = parseVerificationImport(value);
    const current = new Set(report.results.map((item) => item.reviewId));
    for (const item of review.verdicts) {
      if (!current.has(item.reviewId))
        throw new Exit(
          `Review ${item.reviewId} is stale or belongs to another project`,
          "Regenerate the LLM handoff before verifying changed evidence",
        );
      for (const evidence of item.evidence)
        if (!this.matches(evidence)) throw new Exit(`Review evidence changed or cannot be read: ${evidence.path}`);
    }
    const verifiedAt = new Date().toISOString();
    for (const item of review.verdicts)
      writeJson(this.path(item.reviewId), { verifiedAt, review: { ...review, verdicts: [item] } });
    return review.verdicts.length;
  }

  private find(id: string): Verification | null {
    const path = this.path(id);
    if (!existsSync(path)) return null;
    const saved = object<{ verifiedAt: string; review: VerificationImport }>({
      verifiedAt: textValue,
      review: parseVerificationImport,
    })(closed(readJson(path), "saved verification", ["verifiedAt", "review"]));
    const item = saved.review.verdicts[0];
    if (saved.review.verdicts.length !== 1 || item?.reviewId !== id)
      throw new Exit(`Invalid verification cache: ${path}`);
    if (!item.evidence.every((evidence) => this.matches(evidence))) return null;
    return { ...item, reviewer: saved.review.reviewer, verifiedAt: saved.verifiedAt };
  }

  private matches(evidence: Evidence): boolean {
    if (isAbsolute(evidence.path)) return false;
    try {
      const root = realpathSync(this.root);
      const path = realpathSync(resolve(root, evidence.path));
      const inside = relative(root, path);
      if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return false;
      return checksum(readFileSync(path, "utf8")) === evidence.sha256;
    } catch {
      return false;
    }
  }

  private path(id: string): string {
    return join(this.directory, `${hashValue(id)}.json`);
  }
}
