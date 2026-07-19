import type { Profile } from "../types";
import { GitHubRunnerProvider } from "./GitHubRunnerProvider";
import type { RunnerProvider } from "./types";

export type { CleanupOutcome, CleanupReport, CleanupRunOptions } from "./cleanup";
export {
  computeCutoff,
  dirSize,
  isAutoCleanupDue,
  isRunnerActive,
  newestVersion,
  parseExternalsVersion,
  performCleanup,
  resolveCleanupConfig,
  selectPrunableLogFiles,
  selectRemovableVersions,
  totalFreedBytes,
  WORK_DIR,
} from "./cleanup";
export { GitHubRunnerProvider } from "./GitHubRunnerProvider";
export { describeGitHubTarget, type GitHubTarget, parseGitHubUrl } from "./github-url";
export {
  classifyLogFile,
  DIAG_DIR,
  discoverLogFiles,
  formatFileSize,
  pickLogFile,
  sortLogFilesNewestFirst,
  tailLines,
} from "./log-files";
export type { DownloadResult, LogFileType, RunnerInfo, RunnerLogFile, RunnerProvider, RunnerStatus } from "./types";

export function createProvider(profile: Profile): RunnerProvider {
  switch (profile.provider) {
    case "github":
      return new GitHubRunnerProvider(profile);
    default:
      throw new Error(`Runner provider "${profile.provider}" is not yet implemented`);
  }
}
