import { existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Exit } from "@r5n/cli-core";
import { object } from "banditypes";
import { readJson } from "../config/loader";
import type { LoadedConfig } from "../config/types";
import { closed, record, strings, textValue } from "../config/validation";
import { JSON_INDENT } from "../constants";
import { reviewCandidates } from "../reports/llm";
import type { Report } from "../reports/report-data";
import { REVIEW_PROTOCOL } from "../reports/review-protocol";
import { projectPaths, readProjectFile } from "../services/project-files";
import { writeJson } from "../storage/EvaluationStore";
import { checksum, fingerprint } from "../storage/fingerprints";
import { hashValue, parseVerificationImport, type VerificationImport } from "./schema";
import { parseSubmission } from "./submission";
import { verdictTemplate } from "./template";

type SnapshotIdentity = {
  version: 1;
  root: string;
  protocol: string;
  reportHash: string;
  reviewIds: string[];
  files: Record<string, string>;
};

const TEMPLATE_FILE_MODE = 0o600;
const TEMPLATE_SUFFIXES = {
  candidates: "verdicts",
  "all-candidates": "all-verdicts",
  "all-checks": "report-verdicts",
} as const;
export type TemplateSelection = keyof typeof TEMPLATE_SUFFIXES;

export class ReviewSnapshotStore {
  private readonly directory: string;

  constructor(private readonly loaded: LoadedConfig) {
    this.directory = join(loaded.stateDir, "reviews");
  }

  captureFiles(): Record<string, string> {
    const { root, stateDir, config } = this.loaded;
    const state = relative(root, stateDir);
    const statePaths = state ? [state] : ["cache", "reports", "reviews", "verifications"];
    const exclude = [...config.exclude, ".git", ...statePaths];
    const files = new Map<string, string>();
    for (const path of projectPaths(root, exclude)) {
      const source = readProjectFile(root, path);
      if (!source.includes("\0")) files.set(path, checksum(source));
    }
    return Object.fromEntries(files);
  }

  save(report: Report, files: Record<string, string>): void {
    const identity: SnapshotIdentity = {
      version: 1,
      root: report.root,
      protocol: REVIEW_PROTOCOL,
      reportHash: snapshotReportHash(report),
      reviewIds: report.results.map((item) => item.reviewId).sort(),
      files,
    };
    const id = fingerprint(identity);
    const path = this.path(id);
    if (!existsSync(path)) writeJson(path, { identity, report });
    report.snapshotId = id;
  }

  resolve(value: unknown): VerificationImport {
    if (record(value, "verification").version !== 2) return parseVerificationImport(value);
    const submission = parseSubmission(value);
    const snapshot = this.load(submission.snapshotId);
    const known = new Set(snapshot.reviewIds);
    const verdicts: VerificationImport["verdicts"] = [];
    for (const item of submission.verdicts) {
      if (!known.has(item.reviewId)) throw new Exit(`Unknown review ID in snapshot: ${item.reviewId}`);
      if (!item.verdict) continue;
      const evidence = item.evidence.map((path) => {
        const sha256 = Object.hasOwn(snapshot.files, path) ? snapshot.files[path] : undefined;
        if (!sha256)
          throw new Exit(
            `Evidence was not captured in this review: ${path}`,
            "Export a fresh LLM report before reviewing this file",
          );
        return { path, sha256 };
      });
      verdicts.push({ ...item, verdict: item.verdict, evidence });
    }
    return { version: 1, reviewer: submission.reviewer, verdicts };
  }

  saveTemplate(report: Report, selection: TemplateSelection = "candidates"): string {
    if (!report.snapshotId) throw new Exit("Save the review snapshot before creating a verdict template");
    const suffix = TEMPLATE_SUFFIXES[selection];
    const path = join(this.directory, `${hashValue(report.snapshotId)}.${suffix}.json`);
    const selected =
      selection === "all-checks" ? report.results : reviewCandidates(report, selection === "all-candidates");
    const ids = selected.map((item) => item.reviewId);
    try {
      writeFileSync(path, `${JSON.stringify(verdictTemplate(report.snapshotId, ids), null, JSON_INDENT)}\n`, {
        flag: "wx",
        mode: TEMPLATE_FILE_MODE,
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    report.verdictFile = path;
    return path;
  }

  private load(id: string): SnapshotIdentity {
    const path = this.path(id);
    if (!existsSync(path))
      throw new Exit(
        "Review snapshot not found",
        "Use the same Argus config that exported the report, or export a fresh report",
      );
    const raw = closed(readJson(path), "review snapshot", ["identity", "report"]);
    const identity = object<SnapshotIdentity>({
      version: (v) => {
        if (v !== 1) throw new Exit("Unsupported review snapshot version");
        return v;
      },
      root: textValue,
      protocol: textValue,
      reportHash: hashValue,
      reviewIds: (v) => strings(v).map(hashValue),
      files: (v) =>
        Object.fromEntries(Object.entries(record(v, "snapshot files")).map(([path, hash]) => [path, hashValue(hash)])),
    })(closed(raw.identity, "snapshot identity", ["version", "root", "protocol", "reportHash", "reviewIds", "files"]));
    if (fingerprint(identity) !== id || identity.root !== this.loaded.root || identity.protocol !== REVIEW_PROTOCOL)
      throw new Exit("Review snapshot does not match this project or review protocol");
    if (identity.reportHash !== snapshotReportHash(record(raw.report, "snapshot report")))
      throw new Exit("Saved review report does not match its snapshot");
    return identity;
  }

  private path(id: string): string {
    return join(this.directory, `${hashValue(id)}.json`);
  }
}

function snapshotReportHash(report: Record<string, unknown>): string {
  const content: Record<string, unknown> = { ...report, generatedAt: "", snapshotId: null };
  delete content.verdictFile;
  return fingerprint(content);
}
