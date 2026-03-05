import { Exit, select } from "@r5n/cli-core";
import { BaseCommand } from "../../base-command";
import { CLI_BIN } from "../../constants";
import type { Stone } from "../../domain";
import type { StoneManager } from "../../services";

export abstract class StoneBaseCommand extends BaseCommand {
  protected async resolveStone(id: string | undefined, manager: StoneManager, interactive: boolean): Promise<Stone> {
    if (interactive) return this.promptStone(manager);

    if (!id) {
      throw new Exit("Stone ID is required", `Usage: ${CLI_BIN} stone ${this.name} <id>`);
    }

    const stone = await manager.get(id);
    if (!stone) {
      throw new Exit(`Stone '${id}' not found`, `Run '${CLI_BIN} stone list' to see available stones`);
    }

    return stone;
  }

  private async promptStone(manager: StoneManager): Promise<Stone> {
    const stones = await manager.list();

    if (stones.length === 0) throw new Exit("No pending stones found");

    const options = stones.map((s) => ({ label: `${s.id} - ${s.message}`, value: s }));
    return select({ message: `Select a stone to ${this.name}`, options });
  }
}
