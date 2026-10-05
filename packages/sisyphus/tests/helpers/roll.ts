import type { ConfigManager } from "@r5n/cli-core";
import type { RollCommand } from "../../src/commands/roll";
import type { SisyphusConfig } from "../../src/types";

export type RollCtx = Parameters<RollCommand["execute"]>[0];

export function makeCtx(config: ConfigManager<SisyphusConfig>, args: Partial<RollCtx["args"]> = {}): RollCtx {
  return {
    args: { abort: false, noCommit: false, preview: false, publishOnly: false, yes: true, ...args },
    cli: { name: "SISYPHUS" },
    config,
    interactive: false,
    positionals: {},
  } as RollCtx;
}
