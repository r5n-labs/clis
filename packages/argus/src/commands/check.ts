import { validateKnownArgs } from "@r5n/cli-core";
import type { Ctx } from "../base-command";
import { BaseCommand } from "../base-command";
import { JSON_INDENT } from "../constants";
import { reportData } from "../reports/report-data";
import { terminalReport } from "../reports/terminal";
import { RequestBatcher } from "../services/RequestBatcher";
import { loadReview, prepareReview, reviewArgs } from "./shared";

export class CheckCommand extends BaseCommand {
  name = "check";
  description = "Preview pending checks and request count without calling Jev";
  args = reviewArgs;

  async execute(ctx: Ctx<typeof reviewArgs>): Promise<void> {
    validateKnownArgs(ctx.args, reviewArgs, "Run 'argus check --help'");
    const { loaded, store } = loadReview(ctx.args.config);
    const plan = await prepareReview(loaded, store, ctx.args.base);
    const batches = new RequestBatcher().batches(plan, loaded.config);
    const report = reportData(plan, batches.length);
    if (report.summary.blocked) process.exitCode = 1;
    console.log(ctx.args.json ? JSON.stringify(report, null, JSON_INDENT) : terminalReport(report, false));
  }
}
