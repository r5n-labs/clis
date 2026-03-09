import type { ConfigManager } from "../config-manager";
import type { CliMetadata } from "../types";
import type { ArgDefinition, ArgValue, InferArgs } from "./args";
import type { InferPositionals, PositionalDefinition } from "./positionals";

export type CommandContext<
  TConfig extends object = object,
  TPositionals extends Record<string, string | string[] | undefined> = Record<string, string | string[] | undefined>,
  TArgs extends Record<string, ArgValue> = Record<string, ArgValue>,
> = { cli: CliMetadata; config: ConfigManager<TConfig>; positionals: TPositionals; args: TArgs; interactive: boolean };

export type BaseCtx<
  TConfig extends object,
  TArgDefs extends Record<string, ArgDefinition> = Record<string, never>,
  TPositionalDefs extends Record<string, PositionalDefinition> = Record<string, never>,
> = CommandContext<TConfig, InferPositionals<TPositionalDefs>, InferArgs<TArgDefs>>;
