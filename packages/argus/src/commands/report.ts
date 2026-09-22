import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { args, Exit, validateKnownArgs } from "@r5n/cli-core";
import type { Ctx } from "../base-command";
import { BaseCommand } from "../base-command";
import type { LoadedConfig } from "../config/types";
import { JSON_INDENT } from "../constants";
import { htmlReport } from "../reports/html";
import { llmParts, reviewCandidates } from "../reports/llm";
import { llmSummary } from "../reports/llm-summary";
import { type Report, reportData } from "../reports/report-data";
import { terminalReport } from "../reports/terminal";
import { RequestBatcher } from "../services/RequestBatcher";
import { ReviewSnapshotStore, type TemplateSelection } from "../verification/ReviewSnapshotStore";
import { VerificationStore } from "../verification/VerificationStore";
import { loadReview, prepareReview, reviewArgs } from "./shared";

const reportArgs = args({
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

type ReportArgs = Ctx<typeof reportArgs>["args"];
type PreparedReport = {
  report: Report;
  loaded: LoadedConfig;
  snapshots: ReviewSnapshotStore;
  files?: Record<string, string>;
};

export class ReportCommand extends BaseCommand {
  name = "report";
  description = "Show cached results for the current source and questions";
  args = reportArgs;

  async execute(ctx: Ctx<typeof reportArgs>): Promise<void> {
    this.validateOptions(ctx.args);
    const prepared = await this.prepareReport(ctx.args);
    this.saveSnapshot(prepared, this.templateSelection(ctx.args));
    if (ctx.args.llm) {
      this.printLlm(prepared, ctx.args);
      return;
    }
    if (ctx.args.html !== undefined) {
      await this.writeHtml(prepared, ctx.args.html);
      return;
    }
    const { report } = prepared;
    console.log(ctx.args.json ? JSON.stringify(report, null, JSON_INDENT) : terminalReport(report));
  }

  private validateOptions(options: ReportArgs): void {
    validateKnownArgs(options, reportArgs, "Run 'argus report --help'");
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

  private async prepareReport(options: ReportArgs): Promise<PreparedReport> {
    const { loaded, store } = loadReview(options.config);
    const snapshots = new ReviewSnapshotStore(loaded);
    const needsSnapshot = (options.llm && !options.summary) || options.html !== undefined;
    const files = needsSnapshot ? snapshots.captureFiles() : undefined;
    const plan = await prepareReview(loaded, store, options.base);
    const report = reportData(plan, new RequestBatcher().batches(plan, loaded.config).length);
    new VerificationStore(loaded.root, join(loaded.stateDir, "verifications")).apply(report);
    return { report, loaded, snapshots, files };
  }

  private templateSelection(options: ReportArgs): TemplateSelection {
    if (options.html !== undefined) return "all-checks";
    return options["include-verified"] ? "all-candidates" : "candidates";
  }

  private saveSnapshot({ report, snapshots, files }: PreparedReport, selection: TemplateSelection): void {
    if (!files) return;
    snapshots.save(report, files);
    const path = snapshots.saveTemplate(report, selection);
    console.error(`Verdict template: ${path}`);
  }

  private printLlm({ report, loaded }: PreparedReport, options: ReportArgs): void {
    const candidates = reviewCandidates(report, options["include-verified"]);
    const parts = llmParts(report, candidates);
    if (options.summary) {
      console.log(
        llmSummary(report, {
          candidates,
          batches: parts.length,
          config: loaded.path,
          base: options.base,
          includeVerified: options["include-verified"],
        }),
      );
      return;
    }
    const output = options.batch === undefined ? parts.join("\n\n") : parts[options.batch - 1];
    if (!output) throw new Exit(`There are ${parts.length} handoff parts`);
    console.log(output);
  }

  private async writeHtml({ report, loaded }: PreparedReport, destination: string): Promise<void> {
    const path = destination
      ? resolve(destination)
      : join(loaded.stateDir, "reports", `${new Date().toISOString().replaceAll(":", "-")}.html`);
    const html = await htmlReport(report);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, html, { flag: "wx" });
    } catch {
      throw new Exit(`Cannot create report: ${path}`, "Choose an unused file path and check directory permissions");
    }
    console.log(`Report: ${path}`);
  }
}
