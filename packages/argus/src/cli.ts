import { homedir } from "node:os";
import { join } from "node:path";
import { AbstractCLI, ConfigManager } from "@r5n/cli-core";
import { version } from "../package.json";
import type { CliState } from "./base-command";
import { CheckCommand, ConfigCommand, InitCommand, ReportCommand, RunCommand, VerifyCommand } from "./commands";
import { ARGUS_DIR } from "./constants";

class ArgusCLI extends AbstractCLI {
  constructor() {
    super(new ConfigManager<CliState>(join(homedir(), ARGUS_DIR, "cli-state.json"), {}), {
      bin: "argus",
      name: "Argus",
      version,
      clearOnStart: false,
      description: "Incremental, syntax-aware code reviews with Jev",
    });
  }

  init(): void {
    this.registerCommands([
      new InitCommand(),
      new ConfigCommand(),
      new CheckCommand(),
      new RunCommand(),
      new ReportCommand(),
      new VerifyCommand(),
    ]);
  }
}

const cli = new ArgusCLI();
void cli.run();
