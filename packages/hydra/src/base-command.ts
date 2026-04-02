import { AbstractCommand, type ArgDefinition, type BaseCtx, type PositionalDefinition } from "@r5n/cli-core";
import type { HydraConfig } from "./types";

export abstract class BaseCommand extends AbstractCommand<HydraConfig> {}

export type Ctx<
  TArgDefs extends Record<string, ArgDefinition> = Record<string, never>,
  TPositionalDefs extends Record<string, PositionalDefinition> = Record<string, never>,
> = BaseCtx<HydraConfig, TArgDefs, TPositionalDefs>;
