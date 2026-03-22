import type { BackendConfig } from "../../types";

export type BackendAdapter = {
  init(config: BackendConfig): Promise<void>;
  push(storePath: string): Promise<void>;
  pull(storePath: string): Promise<void>;
};
