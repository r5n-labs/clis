import type { SisyphusConfig } from "./types";

export const CLI_BIN = "sis";

export const DEFAULT_CONFIG_DIR = ".sisyphus";
export const DEFAULT_STONES_DIR = "stones";

export const DEFAULT_CONFIG_FILE = "config.json";
export const DEFAULT_CHANGELOG_FILE = "CHANGELOG.md";

export const SISYPHUS_DEFAULT_CONFIG: SisyphusConfig = {
  $schema: "https://raw.githubusercontent.com/r5n-labs/clis/refs/heads/develop/packages/cli/sisyphus/schema.json",

  changelog: {
    append: true,
    filename: DEFAULT_CHANGELOG_FILE,
    generate: true,
    root: false,
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

  commit: { author: "r5n-bot", message: "release(🎉): <packageName@version>" },

  configPath: DEFAULT_CONFIG_DIR,

  ignore: [],

  lastStone: { commit: "", date: "" },

  plugins: [],

  release: { github: false, npm: false, push: false, tags: false },

  scripts: { post: {}, pre: {} },

  single: false,

  stones: [],

  tag: "latest",
};
