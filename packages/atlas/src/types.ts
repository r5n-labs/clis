export type SecretRef = { env?: string; file?: string; trim?: boolean; optional?: boolean };

export type ProfileConfig = {
  description?: string;
  extends?: string[];
  envFiles?: string[];
  vars?: Record<string, string>;
  secrets?: Record<string, SecretRef>;
};

export type AtlasDefaults = { profiles?: string[]; exportFile?: string };

export type AtlasConfig = { $schema?: string; defaults?: AtlasDefaults; profiles: Record<string, ProfileConfig> };

export type LoadedAtlasConfig = {
  config: AtlasConfig;
  cwd: string;
  globalPath?: string;
  home: string;
  profileSources: Record<string, string>;
  projectPath?: string;
  projectRoot?: string;
};

export type ResolvedAtlasEnv = { env: Record<string, string>; exportFile: string; profiles: string[] };
