import { AbstractCLI, ConfigManager } from "@r5n/cli-core";
import { version } from "../package.json";
import { InitCommand } from "./commands/init";
import { MapCommand } from "./commands/map";
import { CLI_BIN, CLI_NAME, DEFAULT_ATLAS_CONFIG, DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE } from "./constants";
import type { AtlasConfig } from "./types";

class AtlasCLI extends AbstractCLI {
  constructor() {
    super(new ConfigManager<AtlasConfig>(`${DEFAULT_CONFIG_DIR}/${DEFAULT_CONFIG_FILE}`, DEFAULT_ATLAS_CONFIG), {
      bin: CLI_BIN,
      clearOnStart: true,
      exitLabel: "Quit",
      goodbyeMessage: "Map complete. Safe travels!",
      name: CLI_NAME.toUpperCase(),
      promptMessage: "What would you like to explore?",
      version,
    });
  }

  init() {
    this.registerCommands([new InitCommand(), new MapCommand()]);
  }
}

const cli = new AtlasCLI();

void cli.run();
