import { Exit, positionals } from "@r5n/cli-core";
import { textValue } from "../config/validation";

export const noPositionals = positionals({ extra: { variadic: true } });

export function rejectExtraArguments(values: string[]): void {
  if (values.length)
    throw new Exit(`Unexpected arguments: ${values.join(" ")}`, "Run the command with --help for usage");
}

export function validateStringOptions(values: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    if (values[key] === undefined) continue;
    try {
      textValue(values[key]);
    } catch {
      throw new Exit(`--${key} requires a value`);
    }
  }
}
