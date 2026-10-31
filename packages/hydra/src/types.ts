export type Provider = "github" | "gitlab";

export type Os = "osx" | "linux" | "windows";

export type DnsHookConfig = { enabled: boolean; hosts: string[]; timeoutSeconds: number };

export type JobHooksConfig = { dns: DnsHookConfig };

export type JobHooksSettings = {
  [Hook in keyof JobHooksConfig]?: Partial<JobHooksConfig[Hook]>;
};

export type Profile = {
  directory: string;
  jobHooks?: JobHooksSettings;
  labels?: string;
  name: string;
  numberOfMachines: number;
  os: Os;
  overwrite: boolean;
  provider: Provider;
  run: boolean;
  runnerGroup?: string;
  url: string;
};

export type RunnerEntry = {
  id: string;
  name: string;
  profile: string;
  provider: Provider;
  url: string;
  directory: string;
  createdAt: string;
};

export type CleanupTarget = "logs" | "work" | "shared";

export type CleanupConfig = {
  auto: boolean;
  intervalHours: number;
  olderThanDays: number;
  targets: CleanupTarget[];
  lastRun?: string;
};

export type HydraConfig = {
  cleanup?: Partial<CleanupConfig>;
  defaultProfile?: string;
  profiles: Record<string, Profile>;
  runners?: RunnerEntry[];
};
