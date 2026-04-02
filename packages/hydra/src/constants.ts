import type { HydraConfig } from "./types";

export const CLI_BIN = "hydra";

export const HYDRA_DIR = ".hydra";
export const HYDRA_CONFIG_FILE = `${HYDRA_DIR}/config.json`;
export const SHARED_DIR = `${HYDRA_DIR}/shared`;
export const RUNNERS_DIR = `${HYDRA_DIR}/runners`;

export const DEFAULT_PROFILE = "default";

export const DEFAULT_CONFIG: HydraConfig = { profiles: {} };
