import { args, color, confirm, Exit, log } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { DEFAULT_CLEANUP_OLDER_THAN_DAYS } from "../constants";
import type { CleanupReport } from "../providers";
import { formatFileSize, isAutoCleanupDue, performCleanup, resolveCleanupConfig, totalFreedBytes } from "../providers";
import type { CleanupTarget } from "../types";

const DAYS_UNSET = 0;

const TARGET_UNITS: Record<CleanupTarget, string> = { logs: "file(s)", shared: "version(s)", work: "item(s)" };

const cleanupArgs = args({
  days: {
    alias: "d",
    default: DAYS_UNSET,
    description: "Override log retention",
    displayDefault: `config or ${DEFAULT_CLEANUP_OLDER_THAN_DAYS} days`,
    type: "number",
  },
  dryRun: { alias: "n", default: false, description: "Preview cleanup without deleting", type: "boolean" },
  logs: { alias: "l", default: false, description: "Remove old diagnostic logs", type: "boolean" },
  shared: { alias: "s", default: false, description: "Remove unused runner versions", type: "boolean" },
  work: { alias: "w", default: false, description: "Clear stopped runners' workspaces", type: "boolean" },
  yes: { alias: "y", default: false, description: "Skip workspace confirmation", type: "boolean" },
});

type CleanupCtx = Ctx<typeof cleanupArgs>;

export class CleanupCommand extends BaseCommand {
  name = "cleanup";
  description = "Remove logs, workspaces, and old runner versions";
  args = cleanupArgs;

  async execute(ctx: CleanupCtx) {
    const profiles = ctx.config.get("profiles");

    if (Object.keys(profiles).length === 0) {
      throw new Exit("No profiles configured", "Run hydra init to set up a profile");
    }

    const resolved = resolveCleanupConfig(ctx.config.get("cleanup"));
    const explicit = this.explicitTargets(ctx);
    let targets = explicit.length > 0 ? explicit : resolved.targets;
    const olderThanDays = ctx.args.days > DAYS_UNSET ? ctx.args.days : resolved.olderThanDays;

    if (targets.includes("work") && !ctx.args.dryRun && !ctx.args.yes) {
      const proceed = await confirm({ message: "Delete _work contents (checkouts and caches) of stopped runners?" });
      if (!proceed) targets = targets.filter((target) => target !== "work");
    }

    const report = await performCleanup({
      dryRun: ctx.args.dryRun,
      entries: ctx.config.get("runners") ?? [],
      now: Date.now(),
      olderThanDays,
      targets,
    });

    this.printReport(report, ctx.args.dryRun);

    if (ctx.args.dryRun) return;
    ctx.config.set("cleanup", { ...ctx.config.get("cleanup"), lastRun: new Date().toISOString() });
  }

  private explicitTargets(ctx: CleanupCtx): CleanupTarget[] {
    const targets: CleanupTarget[] = [];
    if (ctx.args.logs) targets.push("logs");
    if (ctx.args.work) targets.push("work");
    if (ctx.args.shared) targets.push("shared");
    return targets;
  }

  private printReport(report: CleanupReport, dryRun: boolean) {
    const lines: string[] = [];

    for (const [target, outcome] of Object.entries(report) as [CleanupTarget, CleanupReport[CleanupTarget]][]) {
      if (!outcome) continue;

      const unit = TARGET_UNITS[target];
      const size = formatFileSize(outcome.freedBytes);
      const summary = dryRun
        ? `would remove ${outcome.removed} ${unit}, ${size}`
        : `removed ${outcome.removed} ${unit}, freed ${size}`;

      lines.push(`${color.bold(target)}: ${outcome.removed > 0 ? summary : color.dim("nothing to do")}`);

      if (outcome.skipped.length > 0) {
        lines.push(color.dim(`  skipped running runner(s): ${outcome.skipped.join(", ")}`));
      }
    }

    if (lines.length === 0) {
      log.info(color.dim("Nothing to clean."));
      return;
    }

    const freed = totalFreedBytes(report);
    const verb = dryRun ? "Would free" : "Freed";
    lines.push(color.dim(`${verb} ${formatFileSize(freed)} total`));
    log.info(lines.join("\n"));
  }
}

export async function maybeAutoCleanup(ctx: Pick<Ctx, "config">): Promise<void> {
  try {
    const resolved = resolveCleanupConfig(ctx.config.get("cleanup"));
    if (!resolved.auto) return;
    if (!isAutoCleanupDue(resolved, Date.now())) return;

    const report = await performCleanup({
      dryRun: false,
      entries: ctx.config.get("runners") ?? [],
      now: Date.now(),
      olderThanDays: resolved.olderThanDays,
      targets: resolved.targets,
    });

    ctx.config.set("cleanup", { ...ctx.config.get("cleanup"), lastRun: new Date().toISOString() });

    const freed = totalFreedBytes(report);
    if (freed > 0) log.info(color.dim(`Auto cleanup freed ${formatFileSize(freed)}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(color.yellow(`Auto cleanup failed: ${message}`));
  }
}
