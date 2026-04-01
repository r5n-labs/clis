import { Cancel } from "./cancel";
import type { AbstractCommand, ArgValue, CommandContext } from "./command";
import type { ConfigManager } from "./config-manager";
import { Exit } from "./exit";
import { log, select } from "./prompts";
import type { CliMetadata } from "./types";
import { color, handleUnknownItem, mapPositionals, parseCommandArgs, validatePositionals } from "./util";

const EXIT_MENU_VALUE = "__exit__";

type RouterEnv<TConfig extends object> = {
  cli: CliMetadata;
  config: ConfigManager<TConfig>;
  formatHelp: (cmd: AbstractCommand<TConfig>, prefix?: string) => string;
};

type RouterOptions = { isRoot?: boolean; onExit?: () => void };

export class CommandRouter<TConfig extends object = object> {
  constructor(
    private command: AbstractCommand<TConfig>,
    private env: RouterEnv<TConfig>,
    private prefix?: string,
    private options: RouterOptions = {},
  ) {}

  private get commandPath(): string {
    return this.prefix ? `${this.prefix} ${this.command.name}` : this.command.name;
  }

  async route(argv: string[], interactive: boolean): Promise<void> {
    if (interactive) {
      await this.routeInteractive();
    } else {
      await this.routeDirect(argv);
    }
  }

  private async routeDirect(argv: string[]): Promise<void> {
    const [firstArg, ...restArgv] = argv;

    if (firstArg && this.command.hasSubcommands()) {
      const subcommand = this.command.getSubcommand(firstArg);
      if (subcommand) {
        await this.handleSubcommandRoute(subcommand, restArgv);
        return;
      }
      if (!firstArg.startsWith("-")) {
        this.handleUnknownSubcommand(firstArg);
        return;
      }
    }

    await this.executeCommand(argv);
  }

  private handleUnknownSubcommand(name: string): void {
    const names = this.command.getSubcommands().map((cmd) => cmd.name);
    handleUnknownItem("subcommand", name, names, this.commandPath);
  }

  private async handleSubcommandRoute(subcommand: AbstractCommand<TConfig>, argv: string[]): Promise<void> {
    const subRouter = new CommandRouter(subcommand, this.env, this.commandPath);
    await subRouter.route(argv, false);
  }

  private async executeCommand(argv: string[]): Promise<void> {
    if (this.isHelpRequest(argv)) {
      this.printHelp(this.command);
      return;
    }

    const isRouter = this.command.hasSubcommands() && !this.command.execute;

    if (isRouter) {
      this.printHelp(this.command);
      return;
    }

    if (!this.command.execute) {
      return;
    }

    const { args, rawPositionals } = parseCommandArgs(argv, this.command.args);
    const positionals = mapPositionals(rawPositionals, this.command.positionals);

    const validationError = validatePositionals(positionals, this.command.positionals);
    if (validationError) {
      log.error(validationError);
      console.error(`\nRun "${this.commandPath} --help" for usage.`);
      process.exit(1);
    }

    const interactive = this.command.prompts && rawPositionals.length === 0;
    const ctx = this.buildContext(positionals, args, interactive);
    await this.command.execute(ctx);
  }

  private async routeInteractive(): Promise<void> {
    if (!this.command.hasSubcommands()) {
      await this.executeInteractive();
      return;
    }

    await this.runSubcommandMenu();
  }

  private async executeInteractive(): Promise<void> {
    const { args } = parseCommandArgs([], this.command.args);
    const positionals = mapPositionals([], this.command.positionals);
    const ctx = this.buildContext(positionals, args, true);
    await this.command.execute?.(ctx);
  }

  private async runSubcommandMenu(): Promise<void> {
    while (true) {
      const choice = await this.promptSubcommandSelectionOrBack();
      if (choice === null) return;

      if (choice === EXIT_MENU_VALUE) {
        this.options.onExit?.();
        return;
      }

      const subcommand = this.command.getSubcommand(choice);
      if (subcommand) await this.executeSubcommand(subcommand);
    }
  }

  private async promptSubcommandSelectionOrBack(): Promise<string | null> {
    try {
      return await this.promptSubcommandSelection();
    } catch (error) {
      if (error instanceof Cancel) {
        if (this.options.isRoot) this.options.onExit?.();
        return null;
      }
      throw error;
    }
  }

  private async executeSubcommand(subcommand: AbstractCommand<TConfig>): Promise<void> {
    try {
      const subRouter = new CommandRouter(subcommand, this.env, this.commandPath);
      await subRouter.route([], true);
    } catch (error) {
      if (error instanceof Cancel) return;
      if (error instanceof Exit) {
        log.warn(color.yellow(error.message));
        if (error.hint) log.info(color.dim(error.hint));
        return;
      }
      throw error;
    }
  }

  private promptSubcommandSelection() {
    const { isRoot } = this.options;
    const exitOption = isRoot
      ? { hint: this.env.cli.exitHint, label: this.env.cli.exitLabel ?? "Exit", value: EXIT_MENU_VALUE }
      : { hint: "Return to previous menu", label: "Back", value: EXIT_MENU_VALUE };

    return select({
      message: isRoot ? (this.env.cli.promptMessage ?? "Select:") : `${this.command.name}:`,
      options: [
        ...this.command.getSubcommands().map((cmd) => ({ hint: cmd.description, label: cmd.name, value: cmd.name })),
        exitOption,
      ],
    });
  }

  private buildContext(
    positionals: Record<string, string | string[] | undefined>,
    args: Record<string, ArgValue>,
    interactive: boolean,
  ): CommandContext<TConfig> {
    return { ...this.env, args, interactive, positionals };
  }

  private isHelpRequest(argv: string[]): boolean {
    return argv.includes("--help") || argv.includes("-h");
  }

  private printHelp(cmd: AbstractCommand<TConfig>): void {
    const prefix = cmd === this.command ? this.prefix : this.commandPath;
    console.log(this.env.formatHelp(cmd, prefix));
  }
}
