import { args, color, Exit, log, positionals, text } from "@r5n/cli-core";
import type { Ctx } from "../../base-command";
import { StoneManager } from "../../services";
import { StoneBaseCommand } from "./base";

const editPositionals = positionals({ id: { description: "Stone ID to edit" } });

const editArgs = args({ message: { alias: "m", description: "New commit message", type: "string" } });

type EditCtx = Ctx<typeof editArgs, typeof editPositionals>;

export class StoneEditCommand extends StoneBaseCommand {
  name = "edit";
  description = "Edit a pending stone";
  positionals = editPositionals;
  args = editArgs;
  prompts = true;

  async execute(ctx: EditCtx) {
    const manager = new StoneManager(ctx.config);
    const stone = await this.resolveStone(ctx.positionals.id, manager, ctx.interactive);
    const message = await this.resolveMessage(ctx, stone.message);

    const updated = stone.withMessage(message);
    await manager.save(updated);
    log.success(`Updated commit message for stone '${color.bold(stone.id)}'`);
  }

  private async resolveMessage(ctx: EditCtx, currentMessage: string): Promise<string> {
    if (ctx.args.message) return ctx.args.message;

    if (!ctx.interactive) throw new Exit("--message is required in non-interactive mode");

    return text({ initialValue: currentMessage, message: "Commit message", placeholder: currentMessage });
  }
}
