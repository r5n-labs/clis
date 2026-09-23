import { join } from "node:path";
import { args, Exit, validateKnownArgs } from "@r5n/cli-core";
import type { Ctx } from "../base-command";
import { BaseCommand } from "../base-command";
import { JSON_INDENT } from "../constants";
import { JevClient } from "../providers/jev/JevClient";
import { DEFAULT_RETRIES, MAX_RETRIES } from "../providers/jev/retries";
import { ReviewProgress } from "../reports/ReviewProgress";
import { reportData } from "../reports/report-data";
import { runSummary } from "../reports/terminal";
import { RequestBatcher } from "../services/RequestBatcher";
import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, ReviewRunner } from "../services/ReviewRunner";
import { DEFAULT_FOLLOW_UP_LIMIT, ReviewSession, selectRequests } from "../services/ReviewSession";
import { writeJson } from "../storage/EvaluationStore";
import { VerificationStore } from "../verification/VerificationStore";
import { loadReview, prepareReview, reviewArgs } from "./shared";

const runArgs = args({
  ...reviewArgs,
  limit: { type: "number", default: 0, description: "Maximum requests this run (0 means unlimited)" },
  concurrency: { type: "number", default: DEFAULT_CONCURRENCY, description: "Maximum simultaneous requests (1–32)" },
  retries: { type: "number", default: DEFAULT_RETRIES, description: "Retries per failed request (0–10)" },
  "follow-up-limit": {
    type: "number",
    default: DEFAULT_FOLLOW_UP_LIMIT,
    description: "Maximum expanded-context requests this run (0 disables them); also counts towards --limit",
  },
});

export class RunCommand extends BaseCommand {
  name = "run";
  description = "Ask Jev only the questions missing from the cache";
  args = runArgs;

  async execute(ctx: Ctx<typeof runArgs>): Promise<void> {
    validateKnownArgs(ctx.args, runArgs, "Run 'argus run --help'");
    if (!Number.isSafeInteger(ctx.args.limit) || ctx.args.limit < 0)
      throw new Exit("--limit must be a non-negative integer");
    if (!Number.isSafeInteger(ctx.args["follow-up-limit"]) || ctx.args["follow-up-limit"] < 0)
      throw new Exit("--follow-up-limit must be a non-negative integer");
    if (
      !Number.isSafeInteger(ctx.args.concurrency) ||
      ctx.args.concurrency < 1 ||
      ctx.args.concurrency > MAX_CONCURRENCY
    )
      throw new Exit(`--concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
    if (!Number.isSafeInteger(ctx.args.retries) || ctx.args.retries < 0 || ctx.args.retries > MAX_RETRIES)
      throw new Exit(`--retries must be an integer between 0 and ${MAX_RETRIES}`);
    const { loaded, store } = loadReview(ctx.args.config);
    const release = store.lock();
    try {
      const plan = await prepareReview(loaded, store, ctx.args.base);
      const allBatches = new RequestBatcher().batches(plan, loaded.config);
      const options = { limit: ctx.args.limit, followUpLimit: ctx.args["follow-up-limit"] };
      const batches = selectRequests(allBatches, options);
      if (batches.length) {
        const progress = new ReviewProgress();
        const client = new JevClient(process.env.TYPESAFE_API_KEY?.trim() ?? "", fetch, {
          retries: ctx.args.retries,
          onRetry: (notice) => progress.retry(notice),
        });
        await progress.track({
          model: plan.model,
          total: batches.length,
          run: (update) =>
            new ReviewSession(new ReviewRunner(store, client, ctx.args.concurrency)).run(
              plan,
              loaded.config,
              options,
              update,
            ),
        });
      }
      const remaining = new RequestBatcher().batches(plan, loaded.config).length;
      const report = reportData(plan, remaining);
      new VerificationStore(loaded.root, join(loaded.stateDir, "verifications")).apply(report);
      const reportPath = join(loaded.stateDir, "reports", `${new Date().toISOString().replaceAll(":", "-")}.json`);
      writeJson(reportPath, report);
      if (report.summary.blocked) process.exitCode = 1;
      console.log(
        ctx.args.json
          ? JSON.stringify(report, null, JSON_INDENT)
          : runSummary(report, { config: loaded.path, path: reportPath, base: ctx.args.base }),
      );
    } finally {
      release();
    }
  }
}
