import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { Cast } from "banditypes";
import { array, boolean, fail, number, string } from "banditypes";
import {
  DEFAULT_DNS_HOOK_ENABLED,
  DEFAULT_DNS_HOOK_HOSTS,
  DEFAULT_DNS_HOOK_TIMEOUT_SECONDS,
  DEFAULT_WORKSPACE_CLEANUP_ENABLED,
  DEFAULT_WORKSPACE_CLEANUP_KEEP_TOOL_CACHE,
  NEW_PROFILE_WORKSPACE_CLEANUP_ENABLED,
} from "../constants";
import type { JobHooksConfig } from "../types";
import { renderCleanupHook, renderDisabledHook, renderDnsHook } from "./job-hook-scripts";

export type JobHookKind = "started" | "completed";

export type JobHookSync = { envChanged: boolean; scriptsChanged: boolean };

type EnvAssignment = { key: string; managedPath: string; value: string | null };

export const JOB_HOOKS_DIR = "hydra-hooks";
export const ENV_FILE = ".env";
export const JOB_HOOKS: Record<JobHookKind, { envKey: string; file: string }> = {
  started: { envKey: "ACTIONS_RUNNER_HOOK_JOB_STARTED", file: "job-started.sh" },
  completed: { envKey: "ACTIONS_RUNNER_HOOK_JOB_COMPLETED", file: "job-completed.sh" },
};

const JOB_HOOK_KINDS = Object.keys(JOB_HOOKS) as JobHookKind[];
const SCRIPT_MODE = 0o755;
const MAX_HOSTNAME_LENGTH = 253;
const HOSTNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const CONFIG_HINT = "Fix the profile's jobHooks in .hydra/config.json; see the Hydra reference for the allowed values";
const SECTION_KEYS: { [Hook in keyof JobHooksConfig]: readonly (keyof JobHooksConfig[Hook])[] } = {
  dns: ["enabled", "hosts", "timeoutSeconds"],
  workspaceCleanup: ["enabled", "keepToolCache"],
};

const hostnameSchema = string().map((host) =>
  host.length <= MAX_HOSTNAME_LENGTH && HOSTNAME_PATTERN.test(host) ? host : fail(),
);
const hostsSchema = array(hostnameSchema).map((hosts) => (hosts.length > 0 ? hosts : fail()));
const positiveIntegerSchema = number().map((value) => (Number.isSafeInteger(value) && value > 0 ? value : fail()));

function defaultJobHooks(): JobHooksConfig {
  return {
    dns: {
      enabled: DEFAULT_DNS_HOOK_ENABLED,
      hosts: [...DEFAULT_DNS_HOOK_HOSTS],
      timeoutSeconds: DEFAULT_DNS_HOOK_TIMEOUT_SECONDS,
    },
    workspaceCleanup: {
      enabled: DEFAULT_WORKSPACE_CLEANUP_ENABLED,
      keepToolCache: DEFAULT_WORKSPACE_CLEANUP_KEEP_TOOL_CACHE,
    },
  };
}

export function newProfileJobHooks(): JobHooksConfig {
  const hooks = defaultJobHooks();
  return { ...hooks, workspaceCleanup: { ...hooks.workspaceCleanup, enabled: NEW_PROFILE_WORKSPACE_CLEANUP_ENABLED } };
}

export function resolveJobHooks(settings: unknown): JobHooksConfig {
  const defaults = defaultJobHooks();
  const raw = section(settings, "jobHooks", Object.keys(SECTION_KEYS));
  const dns = section(raw.dns, "jobHooks.dns", SECTION_KEYS.dns);
  const cleanup = section(raw.workspaceCleanup, "jobHooks.workspaceCleanup", SECTION_KEYS.workspaceCleanup);

  return {
    dns: {
      enabled: field(boolean(), dns.enabled, defaults.dns.enabled, "jobHooks.dns.enabled", "a boolean"),
      hosts: field(hostsSchema, dns.hosts, defaults.dns.hosts, "jobHooks.dns.hosts", "a non-empty list of hostnames"),
      timeoutSeconds: field(
        positiveIntegerSchema,
        dns.timeoutSeconds,
        defaults.dns.timeoutSeconds,
        "jobHooks.dns.timeoutSeconds",
        "a positive whole number of seconds",
      ),
    },
    workspaceCleanup: {
      enabled: field(
        boolean(),
        cleanup.enabled,
        defaults.workspaceCleanup.enabled,
        "jobHooks.workspaceCleanup.enabled",
        "a boolean",
      ),
      keepToolCache: field(
        boolean(),
        cleanup.keepToolCache,
        defaults.workspaceCleanup.keepToolCache,
        "jobHooks.workspaceCleanup.keepToolCache",
        "a boolean",
      ),
    },
  };
}

export function jobHookPath(runnerDir: string, kind: JobHookKind): string {
  return join(resolve(runnerDir), JOB_HOOKS_DIR, JOB_HOOKS[kind].file);
}

export function renderJobHook(kind: JobHookKind, runnerDir: string, hooks: JobHooksConfig): string | null {
  switch (kind) {
    case "started":
      return hooks.dns.enabled ? renderDnsHook(hooks.dns) : null;
    case "completed":
      return hooks.workspaceCleanup.enabled ? renderCleanupHook(resolve(runnerDir), hooks.workspaceCleanup) : null;
  }
}

export function mergeHookEnv(content: string, assignments: EnvAssignment[]): string {
  const byKey = new Map(assignments.map((assignment) => [assignment.key, assignment]));
  const written = new Set<string>();
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();

  const merged: string[] = [];
  for (const line of lines) {
    const separator = line.indexOf("=");
    const assignment = separator > 0 ? byKey.get(line.slice(0, separator)) : undefined;
    if (!assignment) {
      merged.push(line);
      continue;
    }
    if (assignment.value === null) {
      if (line.slice(separator + 1) !== assignment.managedPath) merged.push(line);
      continue;
    }
    if (written.has(assignment.key)) continue;
    written.add(assignment.key);
    merged.push(`${assignment.key}=${assignment.value}`);
  }

  for (const assignment of assignments) {
    if (assignment.value !== null && !written.has(assignment.key)) merged.push(`${assignment.key}=${assignment.value}`);
  }

  return merged.length > 0 ? `${merged.join("\n")}\n` : "";
}

export async function writeJobHooks(runnerDir: string, hooks: JobHooksConfig): Promise<JobHookSync> {
  const assignments: EnvAssignment[] = [];
  let scriptsChanged = false;

  for (const kind of JOB_HOOK_KINDS) {
    const path = jobHookPath(runnerDir, kind);
    const script = renderJobHook(kind, runnerDir, hooks);
    const existing = await readOptional(path);
    const desired = script ?? (existing === null ? null : renderDisabledHook());
    if (desired !== null && desired !== existing) {
      await writeScript(path, desired);
      scriptsChanged = true;
    }
    assignments.push({ key: JOB_HOOKS[kind].envKey, managedPath: path, value: script === null ? null : path });
  }

  const envPath = join(resolve(runnerDir), ENV_FILE);
  const current = (await readOptional(envPath)) ?? "";
  const next = mergeHookEnv(current, assignments);
  if (next === current) return { envChanged: false, scriptsChanged };

  await writeFile(envPath, next);
  return { envChanged: true, scriptsChanged };
}

function section(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Exit(`Invalid ${label}: expected an object`, CONFIG_HINT);
  }
  const unknownKey = Object.keys(value).find((key) => !keys.includes(key));
  if (unknownKey !== undefined) throw new Exit(`Unknown ${label} setting: ${unknownKey}`, CONFIG_HINT);
  return value as Record<string, unknown>;
}

function field<T>(schema: Cast<T>, value: unknown, fallback: T, label: string, expected: string): T {
  if (value === undefined) return fallback;
  try {
    return schema(value);
  } catch {
    throw new Exit(`Invalid ${label}: expected ${expected}`, CONFIG_HINT);
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeScript(path: string, content: string): Promise<void> {
  const staging = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(staging, content);
    await chmod(staging, SCRIPT_MODE);
    await rename(staging, path);
  } finally {
    await rm(staging, { force: true });
  }
}
