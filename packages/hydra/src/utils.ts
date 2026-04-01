import { Exit, select } from "@r5n/cli-core";
import type { ConfigManager } from "@r5n/cli-core";
import type { HydraConfig } from "./types";

export function resolveRunnerIds(input: string[], available: string[]): string[] {
  if (input.length === 0) return available;

  for (const id of input) {
    if (!available.includes(id)) {
      throw new Exit(`Runner "${id}" not found`);
    }
  }

  return input;
}

export async function selectProfile(config: ConfigManager<HydraConfig>): Promise<string> {
  const profiles = config.get("profiles");
  const names = Object.keys(profiles);

  if (names.length === 0) {
    throw new Exit("No profiles configured", "Run hydra init to set up a profile");
  }

  if (names.length === 1) return names[0] as string;

  return select({
    message: "Select profile",
    options: names.map((name) => ({
      label: name,
      value: name,
      hint: profiles[name]?.url,
    })),
  });
}
