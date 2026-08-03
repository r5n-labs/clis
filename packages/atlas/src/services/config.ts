import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { Exit } from "@r5n/cli-core";
import { boolean, object, optional, string } from "banditypes";
import { ATLAS_CONFIG_FILE, ATLAS_DIR, DEFAULT_ATLAS_CONFIG, DEFAULT_EXPORT_FILE } from "../constants";
import type {
  AtlasConfig,
  AtlasDefaults,
  LoadedAtlasConfig,
  ProfileConfig,
  ResolvedAtlasEnv,
  SecretRef,
} from "../types";
import { resolvePath } from "../utils";
import { ENV_KEY_PATTERN, parseDotenv } from "./dotenv";

type DiscoveryOptions = { cwd?: string; home?: string };

type ResolveOptions = { env?: Record<string, string | undefined>; profiles?: string[] };

type RawConfigLoad = { config: AtlasConfig; path: string; rootDir: string } | undefined;

type UnknownRecord = Record<string, unknown>;

const ENV_KEY_EXPECTATION = "must be a valid environment variable name matching [A-Za-z_][A-Za-z0-9_]*";
const PROTOTYPE_SENSITIVE_PROFILE_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));
const optionalBooleanSchema = boolean().or(optional());
const optionalStringSchema = string().or(optional());
const stringSchema = string();

class AtlasConfigValidationError extends Error {
  readonly _tag = "AtlasConfigValidationError";
}

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

  const profileSources = createRecord<string>();
  const profiles = createRecord<ProfileConfig>();

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
  const env = createRecord<string>();
  const applied: string[] = [];
  const appliedSet = new Set<string>();
  const sourceEnv = options.env ?? process.env;

  function applyProfile(name: string, stack: string[]): void {
    if (appliedSet.has(name)) return;

    const profile = Object.hasOwn(loaded.config.profiles, name) ? loaded.config.profiles[name] : undefined;
    if (!profile) {
      throw new Exit(`Unknown Atlas profile: ${name}`, "Run 'atlas profiles list'");
    }

    if (stack.includes(name)) {
      throw new Exit(`Profile inheritance cycle: ${[...stack, name].join(" -> ")}`);
    }

    for (const parent of profile.extends ?? []) {
      applyProfile(parent, [...stack, name]);
    }

    const profileSource = Object.hasOwn(loaded.profileSources, name) ? loaded.profileSources[name] : undefined;
    const baseDir = profileSource ?? loaded.projectRoot ?? loaded.cwd;

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
    if (error instanceof SyntaxError) {
      throw new Exit(`Invalid JSON in Atlas config ${path}`, "Fix the JSON syntax in the config file");
    }
    throw new Exit(`Failed to read in Atlas config ${path}`);
  }

  try {
    return { config: parseAtlasConfig(parsed), path, rootDir };
  } catch (error) {
    const reason = error instanceof AtlasConfigValidationError ? error.message : "config failed validation";
    throw new Exit(`Invalid Atlas config at ${path}: ${reason}`);
  }
}

function parseAtlasConfig(value: unknown): AtlasConfig {
  const config = parseClosedObject(value, "config", ["$schema", "defaults", "profiles"]);

  return object<AtlasConfig>({
    $schema: (field) => parseOptionalString(field, "$schema"),
    defaults: (field) => parseDefaults(field, "defaults"),
    profiles: (field) => parseProfiles(field, "profiles"),
  })(config);
}

function parseDefaults(value: unknown, path: string): AtlasDefaults | undefined {
  if (value === undefined) return undefined;

  const defaults = parseClosedObject(value, path, ["exportFile", "profiles"]);
  return object<AtlasDefaults>({
    exportFile: (field) => parseOptionalString(field, `${path}.exportFile`),
    profiles: (field) => parseOptionalStringArray(field, `${path}.profiles`),
  })(defaults);
}

function parseProfiles(value: unknown, path: string): Record<string, ProfileConfig> {
  if (value === undefined) return createRecord<ProfileConfig>();

  const rawProfiles = parseObject(value, path);
  const profiles = createRecord<ProfileConfig>();

  for (const name of Object.keys(rawProfiles)) {
    const profilePath = appendPath(path, name);
    if (PROTOTYPE_SENSITIVE_PROFILE_NAMES.has(name)) {
      throw new AtlasConfigValidationError(`${profilePath} must not use a prototype-sensitive profile name`);
    }
    profiles[name] = parseProfile(rawProfiles[name], profilePath);
  }

  return profiles;
}

function parseProfile(value: unknown, path: string): ProfileConfig {
  const profile = parseClosedObject(value, path, ["description", "envFiles", "extends", "secrets", "vars"]);

  return object<ProfileConfig>({
    description: (field) => parseOptionalString(field, `${path}.description`),
    envFiles: (field) => parseOptionalStringArray(field, `${path}.envFiles`),
    extends: (field) => parseOptionalStringArray(field, `${path}.extends`),
    secrets: (field) => parseSecrets(field, `${path}.secrets`),
    vars: (field) => parseVars(field, `${path}.vars`),
  })(profile);
}

function parseVars(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;

  const rawVars = parseObject(value, path);
  const vars = createRecord<string>();

  for (const key of Object.keys(rawVars)) {
    const keyPath = appendPath(path, key);
    parseEnvKey(key, keyPath);
    vars[key] = parseWithSchema(stringSchema, rawVars[key], keyPath, "must be a string");
  }

  return vars;
}

function parseSecrets(value: unknown, path: string): Record<string, SecretRef> | undefined {
  if (value === undefined) return undefined;

  const rawSecrets = parseObject(value, path);
  const secrets = createRecord<SecretRef>();

  for (const key of Object.keys(rawSecrets)) {
    const keyPath = appendPath(path, key);
    parseEnvKey(key, keyPath);
    secrets[key] = parseSecretRef(rawSecrets[key], keyPath);
  }

  return secrets;
}

function parseSecretRef(value: unknown, path: string): SecretRef {
  const ref = parseClosedObject(value, path, ["env", "file", "optional", "trim"]);

  return object<SecretRef>({
    env: (field) => parseOptionalEnvKey(field, `${path}.env`),
    file: (field) => parseOptionalString(field, `${path}.file`),
    optional: (field) => parseOptionalBoolean(field, `${path}.optional`),
    trim: (field) => parseOptionalBoolean(field, `${path}.trim`),
  })(ref);
}

function parseOptionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AtlasConfigValidationError(`${path} must be an array`);
  }

  return value.map((item, index) => parseWithSchema(stringSchema, item, `${path}[${index}]`, "must be a string"));
}

function parseOptionalString(value: unknown, path: string): string | undefined {
  return parseWithSchema(optionalStringSchema, value, path, "must be a string");
}

function parseOptionalEnvKey(value: unknown, path: string): string | undefined {
  const key = parseOptionalString(value, path);
  if (key === undefined) return undefined;
  parseEnvKey(key, path);
  return key;
}

function parseOptionalBoolean(value: unknown, path: string): boolean | undefined {
  return parseWithSchema(optionalBooleanSchema, value, path, "must be a boolean");
}

function parseObject(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AtlasConfigValidationError(`${path} must be an object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AtlasConfigValidationError(`${path} must be an object`);
  }

  return value as UnknownRecord;
}

function parseClosedObject(value: unknown, path: string, allowed: readonly string[]): UnknownRecord {
  const record = parseObject(value, path);

  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new AtlasConfigValidationError(`${path} has unknown key ${JSON.stringify(key)}`);
    }
  }

  return record;
}

function parseEnvKey(key: string, path: string): void {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new AtlasConfigValidationError(`${path} ${ENV_KEY_EXPECTATION}`);
  }
}

function parseWithSchema<T>(schema: (value: unknown) => T, value: unknown, path: string, expectation: string): T {
  try {
    return schema(value);
  } catch {
    throw new AtlasConfigValidationError(`${path} ${expectation}`);
  }
}

function appendPath(path: string, key: string): string {
  return `${path}[${JSON.stringify(key)}]`;
}

function createRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    throw new Exit(`Atlas env file not found: ${path}`, "Create the file or remove it from the profile's envFiles");
  }

  try {
    return parseDotenv(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "env file failed to parse";
    throw new Exit(`Invalid dotenv file ${path}: ${reason}`, "Fix the reported line in the env file");
  }
}

function resolveSecret(
  key: string,
  ref: SecretRef,
  baseDir: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (ref.env) {
    const value = Object.hasOwn(env, ref.env) ? env[ref.env] : undefined;
    if (value !== undefined) return value;
    if (ref.optional) return undefined;
    throw new Exit(
      `Missing required secret ${key}: env ${ref.env} is not set`,
      `Set ${ref.env} or mark the secret optional`,
    );
  }

  if (ref.file) {
    const filePath = resolvePath(ref.file, baseDir);
    if (!existsSync(filePath)) {
      if (ref.optional) return undefined;
      throw new Exit(
        `Missing required secret ${key}: file ${filePath} does not exist`,
        "Create the file or mark the secret optional",
      );
    }
    const value = readFileSync(filePath, "utf8");
    return ref.trim === false ? value : value.trim();
  }

  if (ref.optional) return undefined;
  throw new Exit(`Missing required secret ${key}: secret ref must define env or file`);
}
