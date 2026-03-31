import { Exit } from "@r5n/cli-core";

export function resolveRunnerIds(input: string[], available: string[]): string[] {
  if (input.length === 0) {
    throw new Exit("Specify runner IDs or 'all'", "Example: hydra <command> all");
  }

  if (input.length === 1 && input[0] === "all") {
    return available;
  }

  for (const id of input) {
    if (!available.includes(id)) {
      throw new Exit(`Runner "${id}" not found`);
    }
  }

  return input;
}
