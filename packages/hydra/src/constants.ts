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

export const DEFAULT_DNS_HOOK_ENABLED = true;
export const DEFAULT_DNS_HOOK_TIMEOUT_SECONDS = 120;
export const DEFAULT_DNS_HOOK_HOSTS: readonly string[] = [
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "pipelines.actions.githubusercontent.com",
];
