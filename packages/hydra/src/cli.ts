import { AbstractCLI, ConfigManager } from "@r5n/cli-core";
import { version } from "../package.json";
import { CreateCommand, InitCommand, RemoveCommand } from "./commands";
import { CLI_BIN, DEFAULT_CONFIG, HYDRA_CONFIG_FILE } from "./constants";
import type { HydraConfig } from "./types";

class HydraCLI extends AbstractCLI {
  constructor() {
    super(new ConfigManager<HydraConfig>(HYDRA_CONFIG_FILE, DEFAULT_CONFIG), {
      bin: CLI_BIN,
      clearOnStart: true,
      exitLabel: "Exit",
      goodbyeMessage: "Heads down.",
      name: "HYDRA",
      promptMessage: "What do you need?",
      version,
    });
  }

  init() {
    this.registerCommands([new InitCommand(), new CreateCommand(), new RemoveCommand()]);
  }
}

const cli = new HydraCLI();

void cli.run();
