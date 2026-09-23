import { BaseCommand, type Ctx } from "../../base-command";
import { requireInteractive } from "../prompts";
import { ReviewPrompts } from "./ReviewPrompts";
import { idPositionals, openSnapshot, printJson, snapshotArgs, validateOptions } from "./shared";

export class ReportShowCommand extends BaseCommand {
  name = "show";
  description = "Show a saved check, its question and shared evidence IDs";
  args = snapshotArgs;
  positionals = idPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof snapshotArgs, typeof idPositionals>): Promise<void> {
    validateOptions(ctx.args, snapshotArgs, ctx.positionals.extra);
    if (!ctx.positionals.id) requireInteractive(ctx.interactive, "Use argus report show <review-id>");
    const { catalogue } = openSnapshot(ctx.args);
    const id = ctx.positionals.id ?? (await new ReviewPrompts(catalogue).candidate());
    printJson(catalogue.show(id));
  }
}

export class ReportEvidenceCommand extends BaseCommand {
  name = "evidence";
  description = "Retrieve an exact source fragment from a saved snapshot";
  args = snapshotArgs;
  positionals = idPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof snapshotArgs, typeof idPositionals>): Promise<void> {
    validateOptions(ctx.args, snapshotArgs, ctx.positionals.extra);
    if (!ctx.positionals.id) requireInteractive(ctx.interactive, "Use argus report evidence <evidence-id>");
    const { catalogue } = openSnapshot(ctx.args);
    const id = ctx.positionals.id ?? (await new ReviewPrompts(catalogue).evidence());
    printJson(catalogue.evidence(id));
  }
}
