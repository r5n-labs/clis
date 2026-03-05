export type LastStone = { commit: string; date: string };

export type CommitConfig = { author: string; email?: string; message: string };

export type ReleaseConfig = { github: boolean; npm: boolean; push: boolean; tags: boolean };

export type ChangelogSections = {
  breaking: string;
  build: string;
  chore: string;
  ci: string;
  dependencies: string;
  docs: string;
  feat: string;
  fix: string;
  other: string;
  perf: string;
  refactor: string;
  style: string;
  test: string;
};

export type ChangelogConfig = {
  append: boolean;
  filename: string;
  generate: boolean;
  root: boolean;
  sections: ChangelogSections;
  template?: string;
};

export type ScriptsConfig = { pre: Record<string, string>; post: Record<string, string> };

export type SisyphusConfig = {
  $schema: string;
  changelog: ChangelogConfig;
  commit: CommitConfig;
  configPath: string;
  ignore: string[];
  lastStone: LastStone;
  plugins: string[];
  release: ReleaseConfig;
  scripts: ScriptsConfig;
  single: boolean;
  stones: string[];
  stonesPath?: string;
  tag: string;
};

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
