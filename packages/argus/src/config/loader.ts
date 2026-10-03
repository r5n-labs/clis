import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Exit } from "@r5n/cli-core";
import { ARGUS_DIR } from "../constants";
import type { ArgusConfig, LoadedConfig } from "./types";
import { parseConfig, record } from "./validation";

type ConfigDocument = { path: string; source: string; document: Record<string, unknown>; config: ArgusConfig };

export function readJson(path: string): unknown {
  return readJsonDocument(path).value;
}

function readJsonDocument(path: string): { source: string; value: unknown } {
  try {
    const source = readFileSync(path, "utf8");
    return { source, value: JSON.parse(source) };
  } catch {
    throw new Exit(`Cannot read valid JSON from ${path}`);
  }
}

export function loadConfigDocument(configPath?: string): ConfigDocument {
  const path = configPath === undefined ? discoverConfig() : resolve(configPath);
  try {
    const { source, value } = readJsonDocument(path);
    const document = record(value, "config");
    return { path, source, document, config: parseConfig(document) };
  } catch (error) {
    if (error instanceof Exit) throw error;
    throw new Exit(`Invalid Argus config: ${path}`, "Check field types and the project root");
  }
}

export function loadConfig(configPath?: string): LoadedConfig {
  const { path, config } = loadConfigDocument(configPath);
  try {
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
