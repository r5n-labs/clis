import { hostname } from "node:os";
import type { AtlasConfig, OsType } from "./types";

export const CLI_NAME = "atlas";
export const CLI_BIN = "atlas";

export const DEFAULT_CONFIG_DIR = ".atlas";
export const DEFAULT_CONFIG_FILE = "config.json";
export const DEFAULT_STORE_DIR = "store";

function detectOs(): OsType {
  switch (process.platform) {
    case "darwin": return "macos";
    case "win32": return "windows";
    default: return "linux";
  }
}

export const DEFAULT_ATLAS_CONFIG: AtlasConfig = {
  machine: hostname(),
  os: detectOs(),
  entries: [],
  backend: { type: "directory", path: `~/${DEFAULT_CONFIG_DIR}/backup` },
  compression: false,
  encryption: { enabled: false, cipher: "aes-256-gcm" },
  activeTags: [],
};
