import { AbstractCLI, ConfigManager } from "@r5n/cli-core";
import { version } from "../package.json";
import {
  CheckCommand,
  InitCommand,
  MigrateCommand,
  PrCommand,
  RollCommand,
  StoneCommand,
  VersionCommand,
} from "./commands";
import { CLI_BIN, DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE, SISYPHUS_DEFAULT_CONFIG } from "./constants";
import type { SisyphusConfig } from "./types";

class SisyphusCLI extends AbstractCLI {
  constructor() {
    super(new ConfigManager<SisyphusConfig>(`${DEFAULT_CONFIG_DIR}/${DEFAULT_CONFIG_FILE}`, SISYPHUS_DEFAULT_CONFIG), {
      bin: CLI_BIN,
      clearOnStart: true,
      exitLabel: "Give Up",
      goodbyeMessage: "The boulder rolls back down...",
      name: "SISYPHUS",
      promptMessage: "Choose your boulder:",
      version,
    });
  }

  init() {
    this.registerCommands([
      new CheckCommand(),
      new InitCommand(),
      new MigrateCommand(),
      new PrCommand(),
      new RollCommand(),
      new StoneCommand(),
      new VersionCommand(),
    ]);
  }
}

const cli = new SisyphusCLI();

void cli.run();
