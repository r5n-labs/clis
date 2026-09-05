export type LastStone = { commit: string; date: string };

export type CommitConfig = { author: string; email?: string; message: string };

export type ReleaseBuildConfig = { command: string[]; outputs: string[]; root: string[][] };

export type ReleaseConfig = {
  build: ReleaseBuildConfig;
  createRelease: boolean;
  npm: boolean;
  push: boolean;
  tags: boolean;
};

export type PackageRelease = { oldVersion: string; newVersion: string };

export type CurrentRelease = {
  packages: Record<string, PackageRelease>;
  planHash: string;
  sourceHash: string;
  stoneIds: string[];
  timestamp: string;
};

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
  packageHeader: string;
  root: boolean;
  rootHeader: string;
  sections: ChangelogSections;
  template?: string;
};

export type ScriptsConfig = { pre: Record<string, string>; post: Record<string, string> };

export type PrLabelMapping = Record<string, "major" | "minor" | "patch">;

export type PrSkipConfig = { labels: string[]; authors: string[]; titlePatterns: string[] };

export type PrConfig = { labelMapping: PrLabelMapping; skip: PrSkipConfig };

export type CommitsSkipConfig = { authors: string[]; messagePatterns: string[] };

export type CommitsConfig = { skip: CommitsSkipConfig };

export type DependencyKind = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";

export type UpdateInternalPolicy = "always" | "outOfRange";

export type DependentsConfig = { kinds: DependencyKind[]; updateInternal: UpdateInternalPolicy };

export type SisyphusConfig = {
  $schema: string;
  changelog: ChangelogConfig;
  commit: CommitConfig;
  commits: CommitsConfig;
  currentRelease?: CurrentRelease;
  dependents: DependentsConfig;
  sisyphusDir: string;
  ignore: string[];
  lastStone: LastStone;
  plugins: string[];
  pr: PrConfig;
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
