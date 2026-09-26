import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
import { restoreEvidence, SharedEvidence } from "../reports/SharedEvidence";
import { parseReport } from "../reports/schema";
import { projectPaths, readProjectBytes } from "../services/project-files";
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
const NUL_BYTE = 0;
const TEMPLATE_SUFFIXES = {
  candidates: "verdicts",
  "all-candidates": "all-verdicts",
  "all-checks": "report-verdicts",
} as const;
export type TemplateSelection = keyof typeof TEMPLATE_SUFFIXES;
export type VerdictTemplateSummary = {
  path: string;
  modified: number;
  progress: { completed: number; total: number } | null;
};

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
      const source = readProjectBytes(root, path);
      if (!source.includes(NUL_BYTE)) files.set(path, checksum(source));
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
    if (!existsSync(path)) {
      const shared = new SharedEvidence(report.contexts);
      writeJson(path, { identity, report: { ...report, contexts: shared.contexts }, evidence: shared.fragments });
    }
    report.snapshotId = id;
    writeJson(join(this.directory, "latest.json"), { snapshotId: id });
  }

  resolve(value: unknown): VerificationImport {
    if (record(value, "verification").version !== 2) return parseVerificationImport(value);
    const submission = parseSubmission(value);
    const { identity: snapshot } = this.load(submission.snapshotId);
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

  read(id?: string): Report {
    if (!id && !existsSync(join(this.directory, "latest.json")))
      throw new Exit("No review snapshot found", "Run 'argus report create' first");
    const snapshotId =
      id ?? hashValue(record(readJson(join(this.directory, "latest.json")), "latest snapshot").snapshotId);
    const saved = this.load(snapshotId);
    const report = parseReport(saved.report);
    report.snapshotId = snapshotId;
    return report;
  }

  location(id: string): string {
    return this.path(id);
  }

  templates(): VerdictTemplateSummary[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && Object.values(TEMPLATE_SUFFIXES).some((suffix) => entry.name.endsWith(`.${suffix}.json`)),
      )
      .map((entry) => {
        const path = join(this.directory, entry.name);
        return { path, modified: statSync(path).mtimeMs, progress: this.templateProgress(path) };
      })
      .sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  }

  private templateProgress(path: string): VerdictTemplateSummary["progress"] {
    try {
      const { verdicts } = parseSubmission(readJson(path));
      return { completed: verdicts.filter((item) => item.verdict !== "").length, total: verdicts.length };
    } catch {
      return null;
    }
  }

  private load(id: string): { identity: SnapshotIdentity; report: Record<string, unknown> } {
    const path = this.path(id);
    if (!existsSync(path))
      throw new Exit(
        "Review snapshot not found",
        "Use the same Argus config that exported the report, or export a fresh report",
      );
    const raw = closed(readJson(path), "review snapshot", ["identity", "report", "evidence"]);
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
    const report =
      raw.evidence === undefined ? record(raw.report, "snapshot report") : restoreEvidence(raw.report, raw.evidence);
    if (identity.reportHash !== snapshotReportHash(report))
      throw new Exit("Saved review report does not match its snapshot");
    return { identity, report };
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
