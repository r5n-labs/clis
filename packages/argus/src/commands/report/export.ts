import { Exit, positionals } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { requireInteractive } from "../prompts";
import { ReviewPrompts } from "./ReviewPrompts";
import {
  noPositionals,
  openSnapshot,
  selectedQueue,
  selectionArgs,
  snapshotArgs,
  validateOptions,
  writeHtml,
} from "./shared";

const batchPositionals = positionals({
  number: { description: "Stable batch number, starting at 1 (omit to choose interactively)" },
  extra: { variadic: true },
});
const htmlPositionals = positionals({
  path: { description: "Unused output path (defaults to .argus/reports/<timestamp>.html)" },
  extra: { variadic: true },
});

export class ReportBatchCommand extends BaseCommand {
  name = "batch";
  description = "Print one self-contained batch from a saved snapshot";
  args = selectionArgs;
  positionals = batchPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof selectionArgs, typeof batchPositionals>): Promise<void> {
    validateOptions(ctx.args, selectionArgs, ctx.positionals.extra);
    if (!ctx.positionals.number) requireInteractive(ctx.interactive, "Use argus report batch <number>");
    const queue = selectedQueue(ctx.args.queue);
    const { catalogue } = openSnapshot(ctx.args);
    const input = ctx.positionals.number ?? (await new ReviewPrompts(catalogue).batch(queue));
    const number = Number(input);
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(number) || number < 1)
      throw new Exit("Batch number must be a positive integer");
    console.log(catalogue.part(number, queue));
  }
}

export class ReportExportCommand extends BaseCommand {
  name = "export";
  description = "Print the complete LLM handoff from a saved snapshot";
  args = selectionArgs;
  positionals = noPositionals;

  async execute(ctx: Ctx<typeof selectionArgs, typeof noPositionals>): Promise<void> {
    validateOptions(ctx.args, selectionArgs, ctx.positionals.extra);
    const queue = selectedQueue(ctx.args.queue);
    const parts = openSnapshot(ctx.args).catalogue.parts(queue);
    console.log(parts.length ? parts.join("\n\n") : "No unverified review candidates in this selection.");
  }
}

export class ReportHtmlCommand extends BaseCommand {
  name = "html";
  description = "Write a standalone HTML viewer for a saved snapshot";
  args = snapshotArgs;
  positionals = htmlPositionals;

  async execute(ctx: Ctx<typeof snapshotArgs, typeof htmlPositionals>): Promise<void> {
    validateOptions(ctx.args, snapshotArgs, ctx.positionals.extra);
    const { loaded, report } = openSnapshot(ctx.args, "all-checks");
    await writeHtml(report, loaded.stateDir, ctx.positionals.path);
  }
}
