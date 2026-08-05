import { args, color, confirm, Exit, log, multiselect, note, positionals, text } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { CLI_BIN } from "../../constants";
import { Stone } from "../../domain";
import { StoneManager } from "../../services";

const mergePositionals = positionals({ ids: { description: "Stone IDs to merge (at least 2)", variadic: true } });

const mergeArgs = args({
  delete: { alias: "d", default: false, description: "Delete original stones after merge", type: "boolean" },
  message: { alias: "m", description: "Commit message for merged stone", type: "string" },
});

type MergeCtx = Ctx<typeof mergeArgs, typeof mergePositionals>;

export class StoneMergeCommand extends BaseCommand {
  name = "merge";
  description = "Merge multiple stones into one";
  positionals = mergePositionals;
  args = mergeArgs;
  prompts = true;

  async execute(ctx: MergeCtx) {
    const manager = new StoneManager(ctx.config);

    const stones = await this.resolveStones(ctx, manager);
    const message = await this.resolveMessage(ctx);

    const { stone, conflicts, errors } = Stone.merge(stones, message);
    if (errors.length > 0) {
      throw new Exit("Selected stones cannot be merged", errors.join("\n"));
    }

    await manager.save(stone);

    const shouldDelete = await this.resolveDelete(ctx);
    if (shouldDelete) {
      await manager.deleteMany(stones.map((s) => s.id));
    }

    this.printResult(stone.id, conflicts);
  }

  private async resolveStones(ctx: MergeCtx, manager: StoneManager): Promise<Stone[]> {
    const allStones = await manager.list();

    if (allStones.length < 2) throw new Exit("Need at least 2 stones to merge");

    if (ctx.interactive) return this.promptStones(allStones);

    const ids = ctx.positionals.ids;
    if (ids.length < 2) {
      throw new Exit("Need at least 2 stone IDs", `Usage: ${CLI_BIN} stone merge <id1> <id2> [...] -m "message"`);
    }

    const selected = allStones.filter((s) => ids.includes(s.id));
    if (selected.length !== ids.length) {
      const foundIds = selected.map((s) => s.id);
      const missing = ids.filter((id) => !foundIds.includes(id));
      throw new Exit(`Stone(s) not found: ${missing.join(", ")}`);
    }

    return selected;
  }

  private async resolveMessage(ctx: MergeCtx): Promise<string> {
    if (ctx.args.message) return ctx.args.message;

    if (!ctx.interactive) throw new Exit("--message is required in non-interactive mode");

    return text({ message: "Commit message for merged stone", placeholder: "feat: combined changes" });
  }

  private async resolveDelete(ctx: MergeCtx): Promise<boolean> {
    if (ctx.args.delete) return true;

    if (ctx.interactive) return confirm({ initialValue: false, message: "Delete original stones?" });

    return false;
  }

  private async promptStones(allStones: Stone[]): Promise<Stone[]> {
    const options = allStones.map((s) => ({ label: `${s.id} - ${s.message}`, value: s }));
    const selected = await multiselect({ message: "Select stones to merge (at least 2)", options, required: true });

    if (selected.length < 2) throw new Exit("Need to select at least 2 stones");

    return selected;
  }

  private printResult(mergedId: string, conflicts: readonly string[]): void {
    log.success(`Created merged stone: ${color.bold(mergedId)}`);

    if (conflicts.length > 0) {
      note(
        `Resolved ${conflicts.length} package conflict(s) using highest bump type:\n` +
          conflicts.map((c) => `  ${color.dim("-")} ${c}`).join("\n"),
        color.yellow("Conflicts resolved"),
      );
    }
  }
}
