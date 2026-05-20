import type { AtlasConfig } from "./types";

export const CLI_NAME = "ATLAS";
export const CLI_BIN = "atlas";
export const ATLAS_DIR = ".atlas";
export const ATLAS_CONFIG_FILE = "config.json";
export const DEFAULT_EXPORT_FILE = ".env";

export const DEFAULT_ATLAS_CONFIG: AtlasConfig = {
  defaults: { profiles: [], exportFile: DEFAULT_EXPORT_FILE },
  profiles: {},
};
