import { BaseCommand } from "../../base-command";
import { ProfileDefaultCommand } from "./default";
import { ProfileListCommand } from "./list";
import { ProfileRemoveCommand } from "./remove";

export class ProfileCommand extends BaseCommand {
  name = "profile";
  description = "Manage profiles";

  init() {
    this.registerSubcommands([new ProfileListCommand(), new ProfileRemoveCommand(), new ProfileDefaultCommand()]);
  }
}
