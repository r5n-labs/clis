import type { ArgDefinition } from "@r5n/cli-core";
import { args, validateKnownArgs } from "@r5n/cli-core";
import { ConfigEditor } from "../../config/ConfigEditor";
import { validateStringOptions } from "../options";
import { ConfigActions } from "./ConfigActions";

export { rejectExtraArguments } from "../options";

export const configArgs = args({
  config: { type: "string", description: "Configuration file (defaults to discovered .argus/config.json)" },
});

export function configActions(
  values: Record<string, unknown>,
  definitions: Record<string, ArgDefinition>,
): ConfigActions {
  validateKnownArgs(values, definitions, "Run 'argus config --help'");
  validateStringOptions(values, ["config", "file"]);
  return new ConfigActions(new ConfigEditor(values.config as string | undefined));
}
