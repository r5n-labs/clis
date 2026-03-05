import { BaseCommand } from "../../base-command";
import { StoneDeleteCommand } from "./delete";
import { StoneEditCommand } from "./edit";
import { StoneListCommand } from "./list";
import { StoneMergeCommand } from "./merge";
import { StoneShowCommand } from "./show";

export class StoneCommand extends BaseCommand {
  name = "stone";
  description = "Manage version stones";

  init() {
    this.registerSubcommands([
      new StoneListCommand(),
      new StoneShowCommand(),
      new StoneDeleteCommand(),
      new StoneEditCommand(),
      new StoneMergeCommand(),
    ]);
  }
}
