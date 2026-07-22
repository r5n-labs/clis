import type { SisyphusConfig } from "./types";

export const CLI_BIN = "sis";

export const BULLET_POINT = "🪨";

export const OTHER_COMMIT_TYPE = "other";

export const COMMIT_TYPE_ORDER: Record<string, number> = {
  build: 23,
  chore: 25,
  ci: 24,
  docs: 20,
  feat: 10,
  "feat!": 0,
  fix: 11,
  "fix!": 1,
  perf: 12,
  refactor: 13,
  style: 21,
  test: 22,
  [OTHER_COMMIT_TYPE]: 100,
};

export const COMMIT_TYPE_ORDER_FALLBACK = 50;

export const DEFAULT_CONFIG_DIR = ".sisyphus";
export const DEFAULT_STONES_DIR = "stones";
export const DEFAULT_RELEASED_DIR = "released";

export const SHORT_HASH_LENGTH = 7;
export const UNKNOWN_HASH = "unknown";

export const UNKNOWN_AUTHOR = "unknown";
export const DEFAULT_VERSION = "0.0.0";
export const DEFAULT_NPM_TAG = "latest";
export const DEFAULT_BRANCH = "main";

export const STONE_ID_PAD_LENGTH = 4;
export const SHORT_UUID_LENGTH = 8;

export const DEFAULT_CONFIG_FILE = "config.json";
export const DEFAULT_CHANGELOG_FILE = "CHANGELOG.md";

export const SISYPHUS_DEFAULT_CONFIG: SisyphusConfig = {
  $schema: "https://raw.githubusercontent.com/r5n-labs/clis/refs/heads/develop/packages/sisyphus/schema.json",

  changelog: {
    append: true,
    filename: DEFAULT_CHANGELOG_FILE,
    generate: true,
    packageHeader: "{emoji} {version} ({date})",
    root: false,
    rootHeader: "{date} - {packages}",
    sections: {
      breaking: "Breaking changes",
      build: "Build",
      chore: "Chores",
      ci: "CI",
      dependencies: "Dependency updates",
      docs: "Documentation",
      feat: "Features",
      fix: "Bug fixes",
      other: "Other changes",
      perf: "Performance",
      refactor: "Refactoring",
      style: "Styling",
      test: "Tests",
    },
  },

  commit: { author: "r5n-bot", email: "r5n-bot@users.noreply.github.com", message: "chore(release): {message}" },

  commits: { skip: { authors: ["r5n-bot[bot]"], messagePatterns: ["^chore\\(release\\):", "^chore: add stone"] } },

  ignore: [],

  lastStone: { commit: "", date: "" },

  plugins: [],

  pr: {
    labelMapping: {
      breaking: "major",
      "breaking-change": "major",
      bug: "patch",
      chore: "patch",
      docs: "patch",
      enhancement: "minor",
      feature: "minor",
      fix: "patch",
    },
    skip: {
      authors: ["r5n-bot[bot]"],
      labels: ["sisyphus-release", "skip-stone"],
      titlePatterns: ["^chore\\(release\\):"],
    },
  },

  release: { createRelease: false, npm: false, push: false, tags: false },

  scripts: { post: {}, pre: {} },

  single: false,

  sisyphusDir: DEFAULT_CONFIG_DIR,

  stones: [],

  tag: "latest",
};
