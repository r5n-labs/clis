import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { array, boolean, object, optional, record, string } from "banditypes";
import { ATLAS_CONFIG_FILE, ATLAS_DIR, DEFAULT_ATLAS_CONFIG, DEFAULT_EXPORT_FILE } from "../constants";
import type { AtlasConfig, LoadedAtlasConfig, ProfileConfig, ResolvedAtlasEnv, SecretRef } from "../types";
import { resolvePath } from "../utils";
import { parseDotenv } from "./dotenv";

type DiscoveryOptions = { cwd?: string; home?: string };

type ResolveOptions = { env?: Record<string, string | undefined>; profiles?: string[] };

type RawConfigLoad = { config: AtlasConfig; path: string; rootDir: string } | undefined;

const secretRefSchema = object<SecretRef>({
  env: string().or(optional()),
  file: string().or(optional()),
  optional: boolean().or(optional()),
  trim: boolean().or(optional()),
});

const profileSchema = object<ProfileConfig>({
  description: string().or(optional()),
  envFiles: array(string()).or(optional()),
  extends: array(string()).or(optional()),
  secrets: record(secretRefSchema).or(optional()),
  vars: record(string()).or(optional()),
});

const atlasConfigSchema = object<AtlasConfig>({
  $schema: string().or(optional()),
  defaults: object({ exportFile: string().or(optional()), profiles: array(string()).or(optional()) }).or(optional()),
  profiles: record(profileSchema).or(() => ({})),
});

export function discoverAtlasConfig(options: DiscoveryOptions = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const home = resolve(options.home ?? homedir());
  const globalCandidate = join(home, ATLAS_DIR, ATLAS_CONFIG_FILE);
  const globalPath = existsSync(globalCandidate) ? globalCandidate : undefined;
  const projectPath = findProjectConfig(cwd, globalPath);
  const projectRoot = projectPath ? dirname(dirname(projectPath)) : undefined;

  return { cwd, globalPath, home, projectPath, projectRoot };
}

export function loadAtlasConfig(options: DiscoveryOptions = {}): LoadedAtlasConfig {
  const discovered = discoverAtlasConfig(options);
  const global = loadConfig(discovered.globalPath, discovered.home);
  const project = loadConfig(discovered.projectPath, discovered.projectRoot);

  const profileSources: Record<string, string> = {};
  const profiles: Record<string, ProfileConfig> = {};

  for (const item of [global, project]) {
    if (!item) continue;
    for (const [name, profile] of Object.entries(item.config.profiles)) {
      profiles[name] = profile;
      profileSources[name] = item.rootDir;
    }
  }

  const defaults = {
    ...global?.config.defaults,
    ...project?.config.defaults,
    profiles: [...(global?.config.defaults?.profiles ?? []), ...(project?.config.defaults?.profiles ?? [])],
  };

  return {
    config: { ...DEFAULT_ATLAS_CONFIG, defaults, profiles },
    cwd: discovered.cwd,
    globalPath: discovered.globalPath,
    home: discovered.home,
    profileSources,
    projectPath: discovered.projectPath,
    projectRoot: discovered.projectRoot,
  };
}

export function resolveAtlasEnv(loaded: LoadedAtlasConfig, options: ResolveOptions = {}): ResolvedAtlasEnv {
  const requestedProfiles = [...(loaded.config.defaults?.profiles ?? []), ...(options.profiles ?? [])];
  const env: Record<string, string> = {};
  const applied: string[] = [];
  const appliedSet = new Set<string>();
  const sourceEnv = options.env ?? process.env;

  function applyProfile(name: string, stack: string[]): void {
    if (appliedSet.has(name)) return;

    const profile = loaded.config.profiles[name];
    if (!profile) {
      throw new Error(`Unknown Atlas profile: ${name}`);
    }

    if (stack.includes(name)) {
      throw new Error(`Profile inheritance cycle: ${[...stack, name].join(" -> ")}`);
    }

    for (const parent of profile.extends ?? []) {
      applyProfile(parent, [...stack, name]);
    }

    const baseDir = loaded.profileSources[name] ?? loaded.projectRoot ?? loaded.cwd;

    for (const envFile of profile.envFiles ?? []) {
      Object.assign(env, readEnvFile(resolvePath(envFile, baseDir)));
    }

    Object.assign(env, profile.vars ?? {});

    for (const [key, ref] of Object.entries(profile.secrets ?? {})) {
      const secret = resolveSecret(key, ref, baseDir, sourceEnv);
      if (secret !== undefined) env[key] = secret;
    }

    appliedSet.add(name);
    applied.push(name);
  }

  for (const name of requestedProfiles) {
    applyProfile(name, []);
  }

  const exportFile = resolvePath(
    loaded.config.defaults?.exportFile ?? DEFAULT_EXPORT_FILE,
    loaded.projectRoot ?? loaded.cwd,
  );
  return { env, exportFile, profiles: applied };
}

function findProjectConfig(cwd: string, excludedPath: string | undefined): string | undefined {
  let current = resolve(cwd);
  const root = parse(current).root;

  while (true) {
    const candidate = join(current, ATLAS_DIR, ATLAS_CONFIG_FILE);
    if (existsSync(candidate) && candidate !== excludedPath) return candidate;
    if (current === root) return undefined;
    current = dirname(current);
  }
}

function loadConfig(path: string | undefined, rootDir: string | undefined): RawConfigLoad {
  if (!path || !rootDir) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = error instanceof SyntaxError ? "Invalid JSON" : "Failed to read";
    throw new Error(`${reason} in Atlas config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return { config: atlasConfigSchema(parsed), path, rootDir };
  } catch (error) {
    throw new Error(`Invalid Atlas config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    throw new Error(`Atlas env file not found: ${path}`);
  }
  return parseDotenv(readFileSync(path, "utf8"));
}

function resolveSecret(
  key: string,
  ref: SecretRef,
  baseDir: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (ref.env) {
    const value = env[ref.env];
    if (value !== undefined) return value;
    if (ref.optional) return undefined;
    throw new Error(`Missing required secret ${key}: env ${ref.env} is not set`);
  }

  if (ref.file) {
    const filePath = resolvePath(ref.file, baseDir);
    if (!existsSync(filePath)) {
      if (ref.optional) return undefined;
      throw new Error(`Missing required secret ${key}: file ${filePath} does not exist`);
    }
    const value = readFileSync(filePath, "utf8");
    return ref.trim === false ? value : value.trim();
  }

  if (ref.optional) return undefined;
  throw new Error(`Missing required secret ${key}: secret ref must define env or file`);
}
