import type { Profile } from "../types";
import { GitHubRunnerProvider } from "./GitHubRunnerProvider";
import type { RunnerProvider } from "./types";

export type { CleanupReport } from "./cleanup";
export { isAutoCleanupDue, performCleanup, resolveCleanupConfig, totalFreedBytes } from "./cleanup";
export { parseGitHubUrl } from "./github-url";
export { formatFileSize, pickLogFile, tailLines } from "./log-files";
export type { RunnerInfo, RunnerLogFile } from "./types";

export function createProvider(profile: Profile): RunnerProvider {
  switch (profile.provider) {
    case "github":
      return new GitHubRunnerProvider(profile);
    default:
      throw new Error(`Runner provider "${profile.provider}" is not yet implemented`);
  }
}
