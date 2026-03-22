import { existsSync } from "node:fs";
import type { PresetDef } from "../types";
import { PresetRegistry } from "./PresetRegistry";

export type DetectionResult = {
  preset: PresetDef;
  existingPaths: string[];
};

export function detectConfigs(): DetectionResult[] {
  const registry = new PresetRegistry();
  const detected = registry.detect();

  return detected
    .map((preset) => ({
      preset,
      existingPaths: preset.paths.filter((p) => existsSync(p)),
    }))
    .filter((r) => r.existingPaths.length > 0)
    .sort((a, b) => a.preset.name.localeCompare(b.preset.name));
}
