import type { BackendConfig } from "../../types";
import type { BackendAdapter } from "./types";
import { createGitAdapter } from "./GitAdapter";
import { createGistAdapter } from "./GistAdapter";
import { createDirectoryAdapter } from "./DirectoryAdapter";

export type { BackendAdapter } from "./types";

export function createBackend(config: BackendConfig): BackendAdapter {
  switch (config.type) {
    case "git":
      return createGitAdapter(config);
    case "gist":
      return createGistAdapter(config);
    case "directory":
      return createDirectoryAdapter(config);
  }
}
