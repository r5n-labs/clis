import { args, Exit } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { noPositionals, openSnapshot, printJson, selectedQueue, selectionArgs, validateOptions } from "./shared";

const PAGE_SIZE = 50;
const listArgs = args({
  ...selectionArgs,
  page: { type: "number", default: 1, description: "Page number (50 checks per page)" },
  json: { type: "boolean", default: false, description: "Print structured index" },
});

export class ReportListCommand extends BaseCommand {
  name = "list";
  description = "List review candidates without source evidence";
  args = listArgs;
  positionals = noPositionals;

  async execute(ctx: Ctx<typeof listArgs, typeof noPositionals>): Promise<void> {
    validateOptions(ctx.args, listArgs, ctx.positionals.extra);
    if (!Number.isSafeInteger(ctx.args.page) || ctx.args.page < 1) throw new Exit("--page must be a positive integer");
    const queue = selectedQueue(ctx.args.queue);
    const { report, catalogue } = openSnapshot(ctx.args);
    const items = catalogue.candidates(queue);
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (ctx.args.page > pages) throw new Exit(`There are ${pages} pages`);
    const entries = items
      .slice((ctx.args.page - 1) * PAGE_SIZE, ctx.args.page * PAGE_SIZE)
      .map((item) => catalogue.entry(item));
    if (ctx.args.json) {
      printJson({ snapshotId: report.snapshotId, page: ctx.args.page, pages, total: items.length, entries });
      return;
    }
    console.log(
      [
        `Snapshot: ${report.snapshotId}`,
        `${items.length} candidates · page ${ctx.args.page}/${pages}`,
        ...entries.map(
          (item) =>
            `${item.reviewId}  [${item.queue}] ${item.path}:${item.line}  ${item.target} · ${item.question}: ${item.answer}`,
        ),
      ].join("\n"),
    );
  }
}
