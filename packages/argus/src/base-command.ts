import type { ArgDefinition, BaseCtx, PositionalDefinition } from "@r5n/cli-core";
import { AbstractCommand } from "@r5n/cli-core";

export type CliState = Record<string, never>;
export abstract class BaseCommand extends AbstractCommand<CliState> {}
export type Ctx<
  A extends Record<string, ArgDefinition> = Record<string, never>,
  P extends Record<string, PositionalDefinition> = Record<string, never>,
> = BaseCtx<CliState, A, P>;
