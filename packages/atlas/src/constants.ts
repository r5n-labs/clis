import type { AtlasConfig } from "./types";

export const CLI_NAME = "atlas";
export const CLI_BIN = "atlas";
export const DEFAULT_CONFIG_DIR = ".atlas";
export const DEFAULT_CONFIG_FILE = "config.json";

export const DEFAULT_ATLAS_CONFIG: AtlasConfig = {
  ignore: ["node_modules", ".git", "dist", "build", ".next", ".cache", "coverage"],
  maxDepth: 10,
  output: { format: "json" },
};
