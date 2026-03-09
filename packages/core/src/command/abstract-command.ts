import type { ArgDefinition, InferArgs } from "./args";
import type { CommandContext } from "./context";
import type { PositionalDefinition } from "./positionals";

export type Command<
  TConfig extends object = object,
  TArgDefs extends Record<string, ArgDefinition> = Record<string, ArgDefinition>,
> = {
  name: string;
  description: string;
  args: TArgDefs;
  execute: (
    ctx: CommandContext<TConfig, Record<string, string | string[] | undefined>, InferArgs<TArgDefs>>,
  ) => Promise<void>;
};

export abstract class AbstractCommand<TConfig extends object = object> {
  abstract name: string;
  abstract description: string;
  args: Record<string, ArgDefinition> = {};
  positionals: Record<string, PositionalDefinition> = {};
  prompts = false;

  protected subcommands: Map<string, AbstractCommand<TConfig>> = new Map();

  init?(): void;

  registerSubcommands(commands: AbstractCommand<TConfig>[]) {
    for (const command of commands) {
      command.init?.();
      this.subcommands.set(command.name, command);
    }
  }

  hasSubcommands() {
    return this.subcommands.size > 0;
  }

  getSubcommand(name: string) {
    return this.subcommands.get(name);
  }

  getSubcommands() {
    return Array.from(this.subcommands.values());
  }

  execute?(ctx: CommandContext<TConfig>): Promise<void>;
}
