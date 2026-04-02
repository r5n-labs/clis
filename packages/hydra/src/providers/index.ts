import type { Profile } from "../types";
import { GitHubRunnerProvider } from "./GitHubRunnerProvider";
import type { RunnerProvider } from "./types";

export { GitHubRunnerProvider } from "./GitHubRunnerProvider";
export type { DownloadResult, RunnerInfo, RunnerProvider, RunnerStatus } from "./types";

export function createProvider(profile: Profile): RunnerProvider {
  switch (profile.provider) {
    case "github":
      return new GitHubRunnerProvider(profile);
    default:
      throw new Error(`Runner provider "${profile.provider}" is not yet implemented`);
  }
}
