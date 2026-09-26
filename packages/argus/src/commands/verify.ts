import { join } from "node:path";
import { args, validateKnownArgs } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { readJson } from "../config/loader";
import { reviewCandidates } from "../reports/llm";
import { reportData } from "../reports/report-data";
import { ReviewSnapshotStore } from "../verification/ReviewSnapshotStore";
import { VerificationStore } from "../verification/VerificationStore";
import { noPositionals, rejectExtraArguments, validateStringOptions } from "./options";
import { requireInteractive, reviewBase } from "./prompts";
import { loadReview, prepareReview, reviewArgs } from "./shared";
import { promptVerdictFile } from "./verdict-prompt";

const verifyArgs = args({
  ...reviewArgs,
  import: { type: "string", description: "Import evidence-backed LLM verdicts from JSON" },
});

export class VerifyCommand extends BaseCommand {
  name = "verify";
  description = "Save external LLM verdicts against current source and question fingerprints";
  args = verifyArgs;
  positionals = noPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof verifyArgs, typeof noPositionals>): Promise<void> {
    validateKnownArgs(ctx.args, verifyArgs, "Run 'argus verify --help'");
    rejectExtraArguments(ctx.positionals.extra);
    validateStringOptions(ctx.args, ["config", "base", "import"]);
    if (ctx.args.import === undefined) requireInteractive(ctx.interactive, "Use --import <verdicts.json>");
    const { loaded, store } = loadReview(ctx.args.config);
    const snapshots = new ReviewSnapshotStore(loaded);
    const path = ctx.args.import ?? (await promptVerdictFile(snapshots));
    const value = readJson(path);
    const base = await reviewBase(loaded, ctx.args.base, ctx.interactive);
    const release = store.lock();
    try {
      const plan = await prepareReview(loaded, store, base);
      const verifications = new VerificationStore(loaded.root, join(loaded.stateDir, "verifications"));
      const report = reportData(plan, 0);
      const imported = verifications.import(snapshots.resolve(value), report);
      verifications.apply(report);
      const remaining = reviewCandidates(report).length;
      const uncertain = report.verificationSummary.uncertain;
      console.log(
        ctx.args.json
          ? JSON.stringify({ imported, remaining, uncertain })
          : `Saved ${imported} verification verdicts · ${remaining} candidates remaining · ${uncertain} uncertain`,
      );
    } finally {
      release();
    }
  }
}
