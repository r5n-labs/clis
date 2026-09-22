import { join } from "node:path";
import { args, Exit, validateKnownArgs } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { readJson } from "../config/loader";
import { reviewCandidates } from "../reports/llm";
import { reportData } from "../reports/report-data";
import { ReviewSnapshotStore } from "../verification/ReviewSnapshotStore";
import { VerificationStore } from "../verification/VerificationStore";
import { loadReview, prepareReview, reviewArgs } from "./shared";

const verifyArgs = args({
  ...reviewArgs,
  import: { type: "string", description: "Import evidence-backed LLM verdicts from JSON" },
});

export class VerifyCommand extends BaseCommand {
  name = "verify";
  description = "Save external LLM verdicts against current source and question fingerprints";
  args = verifyArgs;

  async execute(ctx: Ctx<typeof verifyArgs>): Promise<void> {
    validateKnownArgs(ctx.args, verifyArgs, "Run 'argus verify --help'");
    if (!ctx.args.import?.trim()) throw new Exit("Use --import <verdicts.json>");
    const value = readJson(ctx.args.import);
    const { loaded, store } = loadReview(ctx.args.config);
    const release = store.lock();
    try {
      const plan = await prepareReview(loaded, store, ctx.args.base);
      const verifications = new VerificationStore(loaded.root, join(loaded.stateDir, "verifications"));
      const report = reportData(plan, 0);
      const imported = verifications.import(new ReviewSnapshotStore(loaded).resolve(value), report);
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
