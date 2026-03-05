import { color, confirm, log, positionals } from "@r5n/cli-core";
import type { Ctx } from "../../base-command";
import { StoneManager } from "../../services";
import { StoneBaseCommand } from "./base";

const deletePositionals = positionals({ id: { description: "Stone ID to delete" } });

type DeleteCtx = Ctx<Record<string, never>, typeof deletePositionals>;

export class StoneDeleteCommand extends StoneBaseCommand {
  name = "delete";
  description = "Delete a pending stone";
  positionals = deletePositionals;
  prompts = true;

  async execute(ctx: DeleteCtx) {
    const manager = new StoneManager(ctx.config);
    const stone = await this.resolveStone(ctx.positionals.id, manager, ctx.interactive);

    if (ctx.interactive) {
      const confirmed = await confirm({ initialValue: false, message: `Delete stone '${stone.id}'?` });
      if (!confirmed) return;
    }

    await manager.delete(stone.id);
    log.success(`Stone '${color.bold(stone.id)}' deleted`);
  }
}
