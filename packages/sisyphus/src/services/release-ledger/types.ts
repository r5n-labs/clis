import type { lstat } from "node:fs/promises";
import type { StoneJson } from "../../domain";

export const RELEASE_LEDGER_SCHEMA_VERSION = 1 as const;

export const RELEASE_PHASES = ["planned", "local-ready", "external", "completed"] as const;
export const OPERATION_STATES = ["pending", "started", "completed"] as const;
const RELEASE_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z_-]*$/;
export const FULL_GIT_OID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
export const INTEGRITY_PATTERN = /^sha512-[0-9A-Za-z+/]{86}==$/;
export const REMOTE_NAME_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._/-]*$/;
export const WRITE_LOCK_OWNER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const PROCESS_IDENTITY_PATTERN = /^(?:linux:[0-9a-f-]{36}:[0-9]+|ps:.+|windows:[0-9]+)$/i;
export const WRITE_LOCK_SCHEMA_VERSION = 2 as const;
export const WRITE_LOCK_ACQUIRE_ATTEMPTS = 3;
export const PROC_STAT_START_TIME_INDEX = 19;

export type ReleasePhase = (typeof RELEASE_PHASES)[number];
export type ReleaseOperationState = (typeof OPERATION_STATES)[number];

export type ReleaseLedgerOptions = {
  changelog: boolean;
  createRelease: boolean;
  dryRun: false;
  npm: boolean;
  npmTag: string;
  publishOnly: boolean;
  push: boolean;
  tags: boolean;
};

export type ReleaseLedgerPackage = {
  name: string;
  file: string;
  oldVersion: string;
  newVersion: string;
  isPrivate: boolean;
};

export type ReleaseLedgerPackageInput = {
  name: string;
  file: string;
  oldVersion?: string;
  version?: string;
  newVersion?: string;
  isPrivate: boolean;
};

export type ReleaseLedgerStoneInput = StoneJson | { toJson(): StoneJson };

export type ReleaseLedgerArtifact = { path: string; integrity: string };

export type ReleaseLedgerPushRef = { source: string; destination: string; oid: string };

export type ReleaseLedgerRemoteDestination = {
  canonicalUrl: string;
  owner?: string;
  provider?: "bitbucket" | "github" | "gitlab";
  repo?: string;
};

export type ReleaseLedgerProviderRelease = { tag: string; title: string; notes: string };

export type ReleaseLedgerOperation =
  | { state: "pending" }
  | { state: "started"; startedAt: string }
  | { state: "completed"; startedAt: string; completedAt: string };

export type ReleaseLedgerPushOperation = ReleaseLedgerOperation & {
  destination: ReleaseLedgerRemoteDestination;
  remote: string;
  refs: ReleaseLedgerPushRef[];
};

export type ReleaseLedgerProviderReleaseOperation = ReleaseLedgerOperation & ReleaseLedgerProviderRelease;

export type ReleaseLedgerOperations = {
  npm: Record<string, ReleaseLedgerOperation>;
  npmRegistries: Record<string, string>;
  push?: ReleaseLedgerPushOperation;
  providerReleases: Record<string, ReleaseLedgerProviderReleaseOperation>;
};

export type ReleaseLedgerData = {
  schemaVersion: typeof RELEASE_LEDGER_SCHEMA_VERSION;
  id: string;
  baseCommit: string;
  createdAt: string;
  updatedAt: string;
  phase: ReleasePhase;
  options: ReleaseLedgerOptions;
  packages: ReleaseLedgerPackage[];
  releaseTags: string[];
  tagsReady: boolean;
  stones: StoneJson[];
  expectedReleaseTree?: string;
  releaseCommit?: string;
  artifacts: Record<string, ReleaseLedgerArtifact>;
  operations: ReleaseLedgerOperations;
};

export type CreateReleaseLedgerInput = {
  id?: string;
  options: Omit<ReleaseLedgerOptions, "dryRun"> & { dryRun: boolean };
  packages: readonly ReleaseLedgerPackageInput[];
  stones: readonly ReleaseLedgerStoneInput[];
};

export type LedgerPaths = {
  repositoryRoot: string;
  releaseDirectory: string;
  activePath: string;
  artifactsRoot: string;
  historyDirectory: string;
  removingPath: string;
};

export type JsonObject = Record<string, unknown>;

export type WriteLockMetadata = {
  schemaVersion: typeof WRITE_LOCK_SCHEMA_VERSION;
  ownerId: string;
  hostname: string;
  pid: number;
  processStartedAt: string;
  acquiredAt: string;
};

export type LedgerWriteLock = { lockPath: string; metadata: WriteLockMetadata; ownerPath: string };

export type StaleWriteLock = {
  lockPath: string;
  lockStat: Awaited<ReturnType<typeof lstat>>;
  metadata: WriteLockMetadata;
  ownerPath: string;
  ownerStat: Awaited<ReturnType<typeof lstat>>;
};

export class ReleaseLedgerError extends Error {
  readonly _tag = "ReleaseLedgerError";
}

export function invalid(path: string, detail: string): never {
  throw new ReleaseLedgerError(`Invalid release ledger at ${path}: ${detail}`);
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path, "must be a string");
  return value;
}

export function expectNonEmptyString(value: unknown, path: string): string {
  const string = expectString(value, path);
  if (!string.trim()) invalid(path, "must be nonempty");
  return string;
}

export function validateReleaseId(value: unknown, path: string): string {
  const id = expectNonEmptyString(value, path);
  if (!RELEASE_ID_PATTERN.test(id)) invalid(path, `invalid release ID ${id}`);
  return id;
}

export function isCanonicalTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
