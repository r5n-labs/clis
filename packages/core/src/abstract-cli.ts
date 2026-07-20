import { Cancel } from "./cancel";
import type { AbstractCommand, ArgDefinition } from "./command";
import { CommandRouter } from "./command-router";
import type { ConfigManager } from "./config-manager";
import { Exit } from "./exit";
import { intro, log, outro } from "./prompts";
import type { CliMetadata } from "./types";
import { color, HelpFormatter, handleUnknownItem, parseGlobalArgs } from "./util";

const DEFAULT_METADATA: Required<Omit<CliMetadata, "bin" | "version" | "description" | "onError">> = {
  clearOnStart: true,
  exitHint: "Close the CLI",
  exitLabel: "Exit",
  goodbyeMessage: "Goodbye!",
  name: "CLI",
  promptMessage: "What would you like to do?",
};

export abstract class AbstractCLI {
  protected commands: Map<string, AbstractCommand<any>> = new Map();
  protected metadata: CliMetadata;
  protected configManager: ConfigManager<any>;
  protected help: HelpFormatter;
  protected bin: string;

  protected globalArgs: Record<string, ArgDefinition> = {
    help: { alias: "h", description: "Show help", type: "boolean" },
    interactive: { alias: "i", description: "Open interactive mode", type: "boolean" },
    version: { alias: "v", description: "Show version", type: "boolean" },
  };

  constructor(configManager: ConfigManager<any>, metadata: CliMetadata) {
    this.configManager = configManager;
    this.metadata = { ...DEFAULT_METADATA, ...metadata };
    this.bin = this.metadata.bin ?? this.metadata.name;
    this.init();
    this.help = new HelpFormatter(
      {
        bin: this.bin,
        description: this.metadata.description,
        name: this.metadata.name,
        version: this.metadata.version,
      },
      this.commands,
      this.globalArgs,
    );
  }

  abstract init(): void;

  registerCommands(commands: AbstractCommand[]) {
    for (const command of commands) {
      command.init?.();
      this.commands.set(command.name, command);
    }
  }

  async run(argv: string[] = process.argv.slice(2)) {
    const { command, flags, restArgs } = parseGlobalArgs(argv, this.globalArgs);

    if (flags.version && !command) return console.log(this.help.version());
    if (flags.interactive && !command) return this.runInteractive();
    if (!command) return console.log(this.help.global());
    if (command === "help") return this.printHelpFor(restArgs[0]);

    await this.runDirect(command, restArgs, !!flags.help);
  }

  private printHelpFor(name?: string) {
    if (!name) return console.log(this.help.global());

    const cmd = this.commands.get(name);
    if (!cmd) return this.handleUnknownCommand(name);

    console.log(this.help.command(cmd));
  }

  private async runInteractive() {
    this.showIntro();

    const rootCommand = this.createVirtualRootCommand();
    const env = { cli: this.metadata, config: this.configManager, formatHelp: this.help.command.bind(this.help) };
    const router = new CommandRouter(rootCommand, env, this.bin, { isRoot: true, onExit: () => this.exit() });

    try {
      await router.route([], true);
    } catch (error) {
      this.handleError(error);
    }
  }

  private createVirtualRootCommand(): AbstractCommand<any> {
    return {
      description: this.metadata.description,
      getSubcommand: (name: string) => this.commands.get(name),
      getSubcommands: () => Array.from(this.commands.values()),
      hasSubcommands: () => true,
      name: this.metadata.name,
    } as AbstractCommand<any>;
  }

  private exit(): never {
    outro(this.metadata.goodbyeMessage);
    process.exit(0);
  }

  private async runDirect(name: string, argv: string[], showHelp: boolean) {
    const cmd = this.commands.get(name);

    if (!cmd) return this.handleUnknownCommand(name);

    const hasSubcommandArg = argv.length > 0 && !argv[0]?.startsWith("-");
    if (showHelp && !hasSubcommandArg) {
      return console.log(this.help.command(cmd));
    }

    try {
      const env = { cli: this.metadata, config: this.configManager, formatHelp: this.help.command.bind(this.help) };
      const router = new CommandRouter(cmd, env, this.bin);
      await router.route(argv, false);
    } catch (error) {
      this.handleError(error);
    }
  }

  private showIntro() {
    if (this.metadata.clearOnStart) console.clear();

    const version = this.metadata.version ? ` v${this.metadata.version}` : "";
    intro(`${color.bgCyan(color.black(` ${this.metadata.name}${version} `))}`);
  }

  private handleUnknownCommand(name: string) {
    const names = Array.from(this.commands.keys());
    handleUnknownItem("command", name, names, this.bin);
  }

  private handleError(error: unknown) {
    if (this.metadata.onError?.(error)) return;

    if (error instanceof Cancel) {
      process.exit(0);
    }

    if (error instanceof Exit) {
      log.warn(color.yellow(error.message));
      if (error.hint) log.info(color.dim(error.hint));
      process.exit(0);
    }

    if (error instanceof Error) {
      log.error(color.red(error.message));
      process.exit(1);
    }

    console.error(color.red("Error:"), error);
    process.exit(1);
  }
}
