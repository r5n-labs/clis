import { join } from "node:path";
import { args, Exit } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import type { LoadedConfig } from "../../config/types";
import { JSON_INDENT } from "../../constants";
import { llmParts, reviewCandidates } from "../../reports/llm";
import { llmSummary } from "../../reports/llm-summary";
import { type Report, reportData } from "../../reports/report-data";
import { snapshotSummary } from "../../reports/snapshot-summary";
import { RequestBatcher } from "../../services/RequestBatcher";
import { ReviewSnapshotStore, type TemplateSelection } from "../../verification/ReviewSnapshotStore";
import { VerificationStore } from "../../verification/VerificationStore";
import { reviewBase } from "../prompts";
import { loadReview, prepareReview, reviewArgs } from "../shared";
import { noPositionals, validateOptions, writeHtml } from "./shared";

const createArgs = args({
  ...reviewArgs,
  html: { type: "string", description: "Write HTML; optional path defaults to .argus/reports/<timestamp>.html" },
  llm: { type: "boolean", default: false, description: "Print all parts of a copyable, evidence-rich LLM handoff" },
  batch: { type: "number", description: "Print only this LLM handoff part (starts at 1; default: all parts)" },
  summary: {
    type: "boolean",
    default: false,
    description: "Show LLM candidate counts and batch commands without evidence",
  },
  "include-verified": {
    type: "boolean",
    default: false,
    description: "Include previously settled candidates in LLM handoffs",
  },
});

type CreateArgs = Ctx<typeof createArgs>["args"];
type CreateContext = Ctx<typeof createArgs, typeof noPositionals>;
type PreparedReport = {
  report: Report;
  loaded: LoadedConfig;
  snapshots: ReviewSnapshotStore;
  files?: Record<string, string>;
  base?: string;
};

export class ReportCreateCommand extends BaseCommand {
  name = "create";
  description = "Create or refresh the review snapshot and candidate verdict template";
  args = createArgs;
  positionals = noPositionals;
  prompts = true;

  async execute(ctx: CreateContext): Promise<void> {
    validateOptions(ctx.args, createArgs, ctx.positionals.extra);
    this.validateOptions(ctx.args);
    const prepared = await this.prepareReport(ctx.args, ctx.interactive);
    this.saveSnapshot(prepared, this.templateSelection(ctx.args));
    if (ctx.args.llm) {
      this.printLlm(prepared, ctx.args);
      return;
    }
    if (ctx.args.html !== undefined) {
      await writeHtml(prepared.report, prepared.loaded.stateDir, ctx.args.html);
      return;
    }
    const { report, loaded, snapshots } = prepared;
    console.log(
      ctx.args.json
        ? JSON.stringify(report, null, JSON_INDENT)
        : snapshotSummary(report, {
            config: loaded.path,
            path: snapshots.location(report.snapshotId ?? ""),
            base: prepared.base,
          }),
    );
  }

  private validateOptions(options: CreateArgs): void {
    const wantsHtml = options.html !== undefined;
    if (options.json && wantsHtml) throw new Exit("Choose either --json or --html");
    if (options.llm && (options.json || wantsHtml)) throw new Exit("Choose one of --llm, --json or --html");
    if (options.batch !== undefined && (!Number.isSafeInteger(options.batch) || options.batch < 1))
      throw new Exit("--batch must be a positive integer");
    if (!options.llm && (options.batch !== undefined || options["include-verified"]))
      throw new Exit("--batch and --include-verified require --llm");
    if (options.summary && !options.llm) throw new Exit("--summary requires --llm");
    if (options.summary && options.batch !== undefined) throw new Exit("Choose either --summary or --batch");
  }

  private async prepareReport(options: CreateArgs, interactive: boolean): Promise<PreparedReport> {
    const { loaded, store } = loadReview(options.config);
    const base = await reviewBase(loaded, options.base, interactive);
    const snapshots = new ReviewSnapshotStore(loaded);
    const needsSnapshot = !options.json && !options.summary;
    const files = needsSnapshot ? snapshots.captureFiles() : undefined;
    const plan = await prepareReview(loaded, store, base);
    const report = reportData(plan, new RequestBatcher().batches(plan, loaded.config).length);
    new VerificationStore(loaded.root, join(loaded.stateDir, "verifications")).apply(report);
    return { report, loaded, snapshots, files, base };
  }

  private templateSelection(options: CreateArgs): TemplateSelection {
    if (options.html !== undefined) return "all-checks";
    return options["include-verified"] ? "all-candidates" : "candidates";
  }

  private saveSnapshot({ report, snapshots, files }: PreparedReport, selection: TemplateSelection): void {
    if (!files) return;
    snapshots.save(report, files);
    const path = snapshots.saveTemplate(report, selection);
    console.error(`Verdict template: ${path}`);
  }

  private printLlm({ report, loaded, base }: PreparedReport, options: CreateArgs): void {
    const candidates = reviewCandidates(report, options["include-verified"]);
    const parts = llmParts(report, candidates);
    if (options.summary) {
      console.log(
        llmSummary(report, {
          candidates,
          batches: parts.length,
          config: loaded.path,
          base,
          includeVerified: options["include-verified"],
        }),
      );
      return;
    }
    const output = options.batch === undefined ? parts.join("\n\n") : parts[options.batch - 1];
    if (!output) throw new Exit(`There are ${parts.length} handoff parts`);
    console.log(output);
  }
}
