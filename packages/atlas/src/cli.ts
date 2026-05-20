import { AbstractCLI, ConfigManager } from "@r5n/cli-core";
import { version } from "../package.json";
import { ExportCommand, InitCommand, ProfilesCommand, RunCommand } from "./commands";
import { CLI_BIN, CLI_NAME, DEFAULT_ATLAS_CONFIG } from "./constants";
import type { AtlasConfig } from "./types";

class AtlasCLI extends AbstractCLI {
  constructor() {
    super(new ConfigManager<AtlasConfig>(".atlas/config.json", DEFAULT_ATLAS_CONFIG), {
      bin: CLI_BIN,
      clearOnStart: false,
      description: "Profile-based env composition for apps and environments",
      name: CLI_NAME,
      version,
    });
  }

  init(): void {
    this.registerCommands([new InitCommand(), new ProfilesCommand(), new RunCommand(), new ExportCommand()]);
  }
}

const cli = new AtlasCLI();

void cli.run();
