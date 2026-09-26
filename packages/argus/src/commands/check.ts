import { validateKnownArgs } from "@r5n/cli-core";
import type { Ctx } from "../base-command";
import { BaseCommand } from "../base-command";
import { JSON_INDENT } from "../constants";
import { reportData } from "../reports/report-data";
import { terminalReport } from "../reports/terminal";
import { RequestBatcher } from "../services/RequestBatcher";
import { noPositionals, rejectExtraArguments, validateStringOptions } from "./options";
import { reviewBase } from "./prompts";
import { loadReview, prepareReview, reviewArgs } from "./shared";

export class CheckCommand extends BaseCommand {
  name = "check";
  description = "Preview pending checks and request count without calling Jev";
  args = reviewArgs;
  positionals = noPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof reviewArgs, typeof noPositionals>): Promise<void> {
    validateKnownArgs(ctx.args, reviewArgs, "Run 'argus check --help'");
    rejectExtraArguments(ctx.positionals.extra);
    validateStringOptions(ctx.args, ["config", "base"]);
    const { loaded, store } = loadReview(ctx.args.config);
    const base = await reviewBase(loaded, ctx.args.base, ctx.interactive);
    const plan = await prepareReview(loaded, store, base);
    const batches = new RequestBatcher().batches(plan, loaded.config);
    const report = reportData(plan, batches.length);
    if (report.summary.blocked) process.exitCode = 1;
    console.log(ctx.args.json ? JSON.stringify(report, null, JSON_INDENT) : terminalReport(report, false));
  }
}
