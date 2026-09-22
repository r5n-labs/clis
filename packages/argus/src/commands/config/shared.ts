import type { ArgDefinition } from "@r5n/cli-core";
import { args, Exit, validateKnownArgs } from "@r5n/cli-core";
import { ConfigEditor } from "../../config/ConfigEditor";
import { ConfigActions } from "./ConfigActions";

export const configArgs = args({
  config: { type: "string", description: "Configuration file (defaults to discovered .argus/config.json)" },
});

export function configActions(
  values: Record<string, unknown>,
  definitions: Record<string, ArgDefinition>,
): ConfigActions {
  validateKnownArgs(values, definitions, "Run 'argus config --help'");
  for (const key of ["config", "file"]) {
    const value = values[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim()))
      throw new Exit(`--${key} requires a file path`);
  }
  return new ConfigActions(new ConfigEditor(values.config as string | undefined));
}

export function rejectExtraArguments(values: string[]): void {
  if (values.length)
    throw new Exit(`Unexpected arguments: ${values.join(" ")}`, "Run the command with --help for usage");
}
