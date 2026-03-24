import { BaseCommand } from "../../base-command";
import { ActionsInitCommand } from "./init";
import { ActionsReleasePrCommand } from "./release-pr";

export class ActionsCommand extends BaseCommand {
  name = "actions";
  description = "CI/CD integration";

  init() {
    this.registerSubcommands([new ActionsInitCommand(), new ActionsReleasePrCommand()]);
  }
}
