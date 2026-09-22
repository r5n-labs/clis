import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Exit } from "@r5n/cli-core";
import { ARGUS_DIR } from "../constants";
import type { LoadedConfig } from "./types";
import { parseConfig } from "./validation";

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Exit(`Cannot read valid JSON from ${path}`);
  }
}

export function loadConfig(configPath?: string): LoadedConfig {
  const path = configPath ? resolve(configPath) : discoverConfig();
  try {
    const config = parseConfig(readJson(path));
    const root = realpathSync(resolve(dirname(path), config.root));
    if (!statSync(root).isDirectory()) throw new Exit(`Project root is not a directory: ${root}`);
    return { config, path, root, stateDir: dirname(path) };
  } catch (error) {
    if (error instanceof Exit) throw error;
    throw new Exit(`Invalid Argus config: ${path}`, "Check field types and the project root");
  }
}

function discoverConfig(): string {
  let current = process.cwd();
  while (true) {
    const path = join(current, ARGUS_DIR, "config.json");
    if (existsSync(path)) return path;
    const parent = dirname(current);
    if (parent === current) throw new Exit("No Argus config found", "Run 'argus init' or pass --config <path>");
    current = parent;
  }
}
