import { BUILT_IN_PRESETS } from "../domain/presets";
import type { PresetDef } from "../types";

export class PresetRegistry {
  getAll(): PresetDef[] {
    return BUILT_IN_PRESETS;
  }

  get(name: string): PresetDef | undefined {
    return BUILT_IN_PRESETS.find((p) => p.name === name);
  }

  detect(): PresetDef[] {
    return BUILT_IN_PRESETS.filter((p) => p.detect());
  }
}
