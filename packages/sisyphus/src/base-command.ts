import { AbstractCommand, type ArgDefinition, type BaseCtx, type PositionalDefinition } from "@r5n/cli-core";
import type { SisyphusConfig } from "./types";

export abstract class BaseCommand extends AbstractCommand<SisyphusConfig> {}

export type Ctx<
  TArgDefs extends Record<string, ArgDefinition> = Record<string, never>,
  TPositionalDefs extends Record<string, PositionalDefinition> = Record<string, never>,
> = BaseCtx<SisyphusConfig, TArgDefs, TPositionalDefs>;
