import type { CleanupTarget, HydraConfig } from "./types";

export const CLI_BIN = "hydra";

export const HYDRA_DIR = ".hydra";
export const HYDRA_CONFIG_FILE = `${HYDRA_DIR}/config.json`;
export const SHARED_DIR = `${HYDRA_DIR}/shared`;
export const RUNNERS_DIR = `${HYDRA_DIR}/runners`;

export const DEFAULT_PROFILE = "default";

export const DEFAULT_CONFIG: HydraConfig = { profiles: {} };

export const DEFAULT_CLEANUP_AUTO = false;
export const DEFAULT_CLEANUP_INTERVAL_HOURS = 24;
export const DEFAULT_CLEANUP_OLDER_THAN_DAYS = 7;
export const DEFAULT_CLEANUP_TARGETS: CleanupTarget[] = ["logs", "shared"];
