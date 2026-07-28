import { isAbsolute, relative, resolve } from "node:path";
import type { StoneJson } from "../../domain";
import { isEscapingPath } from "../ReleaseSource";
import { getArtifactRelativePath } from "./storage";
import type {
  JsonObject,
  LedgerPaths,
  ReleaseLedgerArtifact,
  ReleaseLedgerData,
  ReleaseLedgerOperation,
  ReleaseLedgerOperations,
  ReleaseLedgerOptions,
  ReleaseLedgerPackage,
  ReleaseLedgerPackageInput,
  ReleaseLedgerProviderRelease,
  ReleaseLedgerProviderReleaseOperation,
  ReleaseLedgerPushOperation,
  ReleaseLedgerPushRef,
  ReleaseLedgerRemoteDestination,
  ReleaseLedgerStoneInput,
  ReleaseOperationState,
  ReleasePhase,
} from "./types";
import {
  errorDetail,
  expectNonEmptyString,
  expectString,
  FULL_GIT_OID_PATTERN,
  INTEGRITY_PATTERN,
  invalid,
  isCanonicalTimestamp,
  OPERATION_STATES,
  RELEASE_LEDGER_SCHEMA_VERSION,
  RELEASE_PHASES,
  REMOTE_NAME_PATTERN,
  ReleaseLedgerError,
  validateReleaseId,
} from "./types";

export function hasExternalProgress(data: ReleaseLedgerData): boolean {
  if (Object.values(data.operations.npm).some((operation) => operation.state !== "pending")) return true;
  if (data.operations.push && data.operations.push.state !== "pending") return true;
  return Object.values(data.operations.providerReleases).some((operation) => operation.state !== "pending");
}

export function serializePackages(inputs: readonly ReleaseLedgerPackageInput[]): ReleaseLedgerPackage[] {
  return inputs.map((input, index) => {
    const path = `create.packages[${index}]`;
    const oldVersion = input.oldVersion ?? input.version;
    if (input.oldVersion !== undefined && input.version !== undefined && input.oldVersion !== input.version) {
      invalid(path, "oldVersion and version must match when both are provided");
    }

    return parsePackage(
      { file: input.file, isPrivate: input.isPrivate, name: input.name, newVersion: input.newVersion, oldVersion },
      path,
    );
  });
}

export function serializeStones(inputs: readonly ReleaseLedgerStoneInput[]): StoneJson[] {
  return inputs.map((input, index) => {
    const source =
      typeof input === "object" && input !== null && "toJson" in input && typeof input.toJson === "function"
        ? input.toJson()
        : input;
    let serialized: unknown;
    try {
      serialized = JSON.parse(JSON.stringify(source));
    } catch (error) {
      throw new ReleaseLedgerError(`Invalid release ledger at create.stones[${index}]: ${errorDetail(error)}`);
    }
    return parseStone(serialized, `create.stones[${index}]`);
  });
}

export function parseLedgerData(value: unknown, paths: LedgerPaths): ReleaseLedgerData {
  const object = expectObject(value, "root");
  expectKeys(
    object,
    [
      "schemaVersion",
      "id",
      "baseCommit",
      "createdAt",
      "updatedAt",
      "phase",
      "options",
      "packages",
      "releaseTags",
      "tagsReady",
      "stones",
      "artifacts",
      "operations",
    ],
    ["expectedReleaseTree", "releaseCommit"],
    "root",
  );

  if (object.schemaVersion !== RELEASE_LEDGER_SCHEMA_VERSION) {
    invalid("schemaVersion", `unsupported schema version ${String(object.schemaVersion)}`);
  }

  const id = validateReleaseId(object.id, "id");
  const baseCommit = expectGitOid(object.baseCommit, "baseCommit");
  const createdAt = expectTimestamp(object.createdAt, "createdAt");
  const updatedAt = expectTimestamp(object.updatedAt, "updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) invalid("updatedAt", "must not precede createdAt");
  const phase = parseEnum(object.phase, RELEASE_PHASES, "phase", "release phase");
  const options = parseOptions(object.options, "options");
  const packages = parsePackages(object.packages, paths.repositoryRoot);
  const releaseTags = parseReleaseTags(object.releaseTags, packages, options);
  const tagsReady = expectBoolean(object.tagsReady, "tagsReady");
  if (!options.tags && !tagsReady) invalid("tagsReady", "must be true when tags are disabled");
  const stones = parseStones(object.stones);
  const expectedReleaseTree =
    object.expectedReleaseTree === undefined
      ? undefined
      : expectGitOid(object.expectedReleaseTree, "expectedReleaseTree");
  const releaseCommit =
    object.releaseCommit === undefined ? undefined : expectGitOid(object.releaseCommit, "releaseCommit");
  const artifacts = parseArtifacts(object.artifacts, packages, paths, id);
  const operations = parseOperations(object.operations, packages, options, createdAt, updatedAt);
  const data: ReleaseLedgerData = {
    artifacts,
    baseCommit,
    createdAt,
    id,
    operations,
    options,
    packages,
    phase,
    releaseTags,
    schemaVersion: RELEASE_LEDGER_SCHEMA_VERSION,
    stones,
    tagsReady,
    updatedAt,
  };
  if (expectedReleaseTree !== undefined) data.expectedReleaseTree = expectedReleaseTree;
  if (releaseCommit !== undefined) data.releaseCommit = releaseCommit;
  if (options.tags && tagsReady && !releaseCommit) {
    invalid("tagsReady", "cannot be true before releaseCommit is recorded");
  }
  if (phase === "completed") assertCompletionReady(data);
  return data;
}

function parseReleaseTags(
  value: unknown,
  packages: readonly ReleaseLedgerPackage[],
  options: ReleaseLedgerOptions,
): string[] {
  if (!Array.isArray(value)) invalid("releaseTags", "must be an array");
  const tags = value.map((tag, index) => {
    const normalized = expectNonEmptyString(tag, `releaseTags[${index}]`);
    parseExactRef(`refs/tags/${normalized}`, `releaseTags[${index}]`);
    return normalized;
  });
  if (new Set(tags).size !== tags.length) invalid("releaseTags", "must not contain duplicates");
  const expected = options.tags ? packages.map((pkg) => `${pkg.name}@${pkg.newVersion}`).sort() : [];
  if (JSON.stringify([...tags].sort()) !== JSON.stringify(expected)) {
    invalid("releaseTags", "must exactly match the release package versions when tags are enabled");
  }
  return tags;
}

function parseOptions(value: unknown, path: string): ReleaseLedgerOptions {
  const object = expectObject(value, path);
  expectKeys(
    object,
    ["changelog", "createRelease", "dryRun", "npm", "npmTag", "publishOnly", "push", "tags"],
    [],
    path,
  );
  return {
    changelog: expectBoolean(object.changelog, `${path}.changelog`),
    createRelease: expectBoolean(object.createRelease, `${path}.createRelease`),
    dryRun: validateDryRun(object.dryRun),
    npm: expectBoolean(object.npm, `${path}.npm`),
    npmTag: expectNonEmptyString(object.npmTag, `${path}.npmTag`),
    publishOnly: expectBoolean(object.publishOnly, `${path}.publishOnly`),
    push: expectBoolean(object.push, `${path}.push`),
    tags: expectBoolean(object.tags, `${path}.tags`),
  };
}

function parsePackages(value: unknown, repositoryRoot: string): ReleaseLedgerPackage[] {
  if (!Array.isArray(value) || value.length === 0) invalid("packages", "must be a nonempty array");
  const names = new Set<string>();
  const files = new Set<string>();

  return value.map((entry, index) => {
    const path = `packages[${index}]`;
    const pkg = parsePackage(entry, path);
    if (isAbsolute(pkg.file)) invalid(`${path}.file`, "must be repository-relative");
    if (names.has(pkg.name)) invalid(path, `duplicate package name ${pkg.name}`);
    const fileIdentity = resolve(repositoryRoot, pkg.file);
    const repositoryRelativePath = relative(repositoryRoot, fileIdentity);
    if (!repositoryRelativePath || isEscapingPath(repositoryRelativePath)) {
      invalid(`${path}.file`, "must resolve inside the repository");
    }
    if (files.has(fileIdentity)) invalid(path, `duplicate package file ${pkg.file}`);
    names.add(pkg.name);
    files.add(fileIdentity);
    return pkg;
  });
}

function parsePackage(value: unknown, path: string): ReleaseLedgerPackage {
  const object = expectObject(value, path);
  expectKeys(object, ["name", "file", "oldVersion", "newVersion", "isPrivate"], [], path);
  const file = expectNonEmptyString(object.file, `${path}.file`);
  if (file.includes("\0")) invalid(`${path}.file`, "must not contain a null byte");
  return {
    file,
    isPrivate: expectBoolean(object.isPrivate, `${path}.isPrivate`),
    name: expectNonEmptyString(object.name, `${path}.name`),
    newVersion: expectNonEmptyString(object.newVersion, `${path}.newVersion`),
    oldVersion: expectNonEmptyString(object.oldVersion, `${path}.oldVersion`),
  };
}

function parseStones(value: unknown): StoneJson[] {
  if (!Array.isArray(value)) invalid("stones", "must be an array");
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const stone = parseStone(entry, `stones[${index}]`);
    if (ids.has(stone.id)) invalid(`stones[${index}].id`, `duplicate stone ID ${stone.id}`);
    ids.add(stone.id);
    return stone;
  });
}

function parseStone(value: unknown, path: string): StoneJson {
  const object = expectObject(value, path);
  expectKeys(
    object,
    ["id", "message"],
    ["tag", "description", "commits", "major", "minor", "patch", "dependency", "snapshot"],
    path,
  );
  const stone: StoneJson = {
    id: expectNonEmptyString(object.id, `${path}.id`),
    message: expectNonEmptyString(object.message, `${path}.message`),
  };
  if (object.tag !== undefined) stone.tag = expectNonEmptyString(object.tag, `${path}.tag`);
  if (object.description !== undefined) stone.description = expectString(object.description, `${path}.description`);
  if (object.commits !== undefined) stone.commits = parseCommits(object.commits, `${path}.commits`);

  for (const key of ["major", "minor", "patch", "dependency", "snapshot"] as const) {
    if (object[key] !== undefined) stone[key] = parseNonEmptyStringArray(object[key], `${path}.${key}`);
  }
  return stone;
}

function parseCommits(value: unknown, path: string): NonNullable<StoneJson["commits"]> {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const object = expectObject(entry, entryPath);
    expectKeys(object, ["hash", "subject", "type", "message", "packages"], ["body", "scope"], entryPath);
    const commit = {
      hash: expectNonEmptyString(object.hash, `${entryPath}.hash`),
      message: expectNonEmptyString(object.message, `${entryPath}.message`),
      packages: parseNonEmptyStringArray(object.packages, `${entryPath}.packages`),
      subject: expectNonEmptyString(object.subject, `${entryPath}.subject`),
      type: expectNonEmptyString(object.type, `${entryPath}.type`),
    };
    return {
      ...commit,
      ...(object.body === undefined ? {} : { body: expectString(object.body, `${entryPath}.body`) }),
      ...(object.scope === undefined ? {} : { scope: expectNonEmptyString(object.scope, `${entryPath}.scope`) }),
    };
  });
}

function parseArtifacts(
  value: unknown,
  packages: readonly ReleaseLedgerPackage[],
  paths: LedgerPaths,
  id: string,
): Record<string, ReleaseLedgerArtifact> {
  const object = expectObject(value, "artifacts");
  const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const artifacts = createStringRecord<ReleaseLedgerArtifact>();

  for (const [packageName, entry] of Object.entries(object)) {
    const pkg = packageMap.get(packageName);
    if (!pkg) invalid(`artifacts.${packageName}`, "references an unknown package");
    if (pkg.isPrivate) invalid(`artifacts.${packageName}`, "private packages cannot have artifacts");
    const path = `artifacts.${packageName}`;
    const artifact = expectObject(entry, path);
    expectKeys(artifact, ["path", "integrity"], [], path);
    const artifactPath = expectNonEmptyString(artifact.path, `${path}.path`);
    if (isAbsolute(artifactPath)) invalid(`${path}.path`, "must be relative to the release directory");
    const expectedPath = getArtifactRelativePath(paths, id, packageName);
    if (artifactPath !== expectedPath) invalid(`${path}.path`, `must be ${expectedPath}`);
    const integrity = expectNonEmptyString(artifact.integrity, `${path}.integrity`);
    if (!INTEGRITY_PATTERN.test(integrity)) invalid(`${path}.integrity`, "must be a sha512 SRI value");
    setRecordValue(artifacts, packageName, { integrity, path: artifactPath });
  }
  return artifacts;
}

function parseOperations(
  value: unknown,
  packages: readonly ReleaseLedgerPackage[],
  options: ReleaseLedgerOptions,
  createdAt: string,
  updatedAt: string,
): ReleaseLedgerOperations {
  const object = expectObject(value, "operations");
  expectKeys(object, ["npm", "npmRegistries", "providerReleases"], ["push"], "operations");
  const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const npmObject = expectObject(object.npm, "operations.npm");
  const npm = createStringRecord<ReleaseLedgerOperation>();

  for (const [packageName, rawOperation] of Object.entries(npmObject)) {
    const pkg = packageMap.get(packageName);
    if (!pkg) invalid(`operations.npm.${packageName}`, "references an unknown package");
    if (pkg.isPrivate) invalid(`operations.npm.${packageName}`, "private packages cannot have npm operations");
    if (!options.npm) invalid(`operations.npm.${packageName}`, "npm is disabled");
    const operation = parseOperation(rawOperation, `operations.npm.${packageName}`);
    validateOperationWindow(operation, createdAt, updatedAt, `operations.npm.${packageName}`);
    setRecordValue(npm, packageName, operation);
  }

  const expectedNpmNames = options.npm ? packages.filter((pkg) => !pkg.isPrivate).map((pkg) => pkg.name) : [];
  for (const packageName of expectedNpmNames) {
    if (!npm[packageName]) invalid("operations.npm", `missing public package ${packageName}`);
  }

  const registryObject = expectObject(object.npmRegistries, "operations.npmRegistries");
  const npmRegistries = createStringRecord<string>();
  for (const [packageName, registry] of Object.entries(registryObject)) {
    if (!npm[packageName]) invalid(`operations.npmRegistries.${packageName}`, "references an unknown npm operation");
    setRecordValue(
      npmRegistries,
      packageName,
      normalizeRegistryUrl(registry, `operations.npmRegistries.${packageName}`),
    );
  }

  let push: ReleaseLedgerPushOperation | undefined;
  if (object.push !== undefined) {
    if (!options.push && !options.tags) invalid("operations.push", "push and tags are disabled");
    const pushObject = expectObject(object.push, "operations.push");
    expectKeys(pushObject, ["destination", "remote", "refs", "state"], ["startedAt", "completedAt"], "operations.push");
    const configuration = parsePushConfiguration(pushObject, "operations.push");
    const operation = parseOperation(pushObject, "operations.push", ["destination", "remote", "refs"]);
    validateOperationWindow(operation, createdAt, updatedAt, "operations.push");
    push = { ...configuration, ...operation };
  }

  const providerObject = expectObject(object.providerReleases, "operations.providerReleases");
  const providerReleases = createStringRecord<ReleaseLedgerProviderReleaseOperation>();
  for (const [packageName, rawOperation] of Object.entries(providerObject)) {
    if (!packageMap.has(packageName)) {
      invalid(`operations.providerReleases.${packageName}`, "references an unknown package");
    }
    if (!options.createRelease) invalid(`operations.providerReleases.${packageName}`, "createRelease is disabled");
    const path = `operations.providerReleases.${packageName}`;
    const releaseObject = expectObject(rawOperation, path);
    expectKeys(releaseObject, ["tag", "title", "notes", "state"], ["startedAt", "completedAt"], path);
    const configuration = parseProviderRelease(releaseObject, path);
    const operation = parseOperation(releaseObject, path, ["tag", "title", "notes"]);
    validateOperationWindow(operation, createdAt, updatedAt, path);
    setRecordValue(providerReleases, packageName, { ...configuration, ...operation });
  }

  return { npm, npmRegistries, providerReleases, ...(push ? { push } : {}) };
}

function parseOperation(value: unknown, path: string, metadataKeys: readonly string[] = []): ReleaseLedgerOperation {
  const object = expectObject(value, path);
  expectKeys(object, ["state", ...metadataKeys], ["startedAt", "completedAt"], path);
  const state = parseEnum(object.state, OPERATION_STATES, `${path}.state`, "operation state");

  if (state === "pending") {
    if (object.startedAt !== undefined || object.completedAt !== undefined) {
      invalid(path, "pending operations cannot have timestamps");
    }
    return { state };
  }

  const startedAt = expectTimestamp(object.startedAt, `${path}.startedAt`);
  if (state === "started") {
    if (object.completedAt !== undefined) invalid(path, "started operations cannot have completedAt");
    return { startedAt, state };
  }

  const completedAt = expectTimestamp(object.completedAt, `${path}.completedAt`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) invalid(path, "completedAt must not precede startedAt");
  return { completedAt, startedAt, state };
}

export function parsePushConfiguration(
  value: unknown,
  path: string,
): { destination: ReleaseLedgerRemoteDestination; remote: string; refs: ReleaseLedgerPushRef[] } {
  const object = expectObject(value, path);
  const destination = parseRemoteDestination(object.destination, `${path}.destination`);
  const remote = expectNonEmptyString(object.remote, `${path}.remote`);
  if (!REMOTE_NAME_PATTERN.test(remote) || remote.includes("..") || remote.includes("//")) {
    invalid(`${path}.remote`, "must be a git remote name, not a URL or credential-bearing value");
  }
  if (!Array.isArray(object.refs) || object.refs.length === 0) invalid(`${path}.refs`, "must be a nonempty array");

  const sources = new Set<string>();
  const destinations = new Set<string>();
  const refs = object.refs.map((entry, index) => {
    const refPath = `${path}.refs[${index}]`;
    const refObject = expectObject(entry, refPath);
    expectKeys(refObject, ["source", "destination", "oid"], [], refPath);
    const source = parseExactRef(refObject.source, `${refPath}.source`);
    const destination = parseExactRef(refObject.destination, `${refPath}.destination`);
    const oid = expectNonEmptyString(refObject.oid, `${refPath}.oid`);
    if (!FULL_GIT_OID_PATTERN.test(oid)) invalid(`${refPath}.oid`, "must be a full 40- or 64-character git object ID");
    if (sources.has(source)) invalid(`${refPath}.source`, `duplicate source ref ${source}`);
    if (destinations.has(destination)) invalid(`${refPath}.destination`, `duplicate destination ref ${destination}`);
    sources.add(source);
    destinations.add(destination);
    return { destination, oid, source };
  });
  return { destination, refs, remote };
}

function parseRemoteDestination(value: unknown, path: string): ReleaseLedgerRemoteDestination {
  const object = expectObject(value, path);
  expectKeys(object, ["canonicalUrl"], ["owner", "provider", "repo"], path);
  const canonicalUrl = expectNonEmptyString(object.canonicalUrl, `${path}.canonicalUrl`);
  let url: URL;
  try {
    url = new URL(canonicalUrl);
  } catch {
    invalid(`${path}.canonicalUrl`, "must be an absolute credential-free URL");
  }
  const sshScheme = url.protocol === "ssh:" || url.protocol === "git+ssh:";
  if (url.password || (url.username && !sshScheme) || url.search || url.hash) {
    invalid(`${path}.canonicalUrl`, "must not contain credentials, query parameters, or fragments");
  }

  const metadata = [object.provider, object.owner, object.repo];
  if (metadata.every((entry) => entry === undefined)) return { canonicalUrl };
  if (metadata.some((entry) => entry === undefined)) invalid(path, "provider, owner, and repo must be set together");
  const provider = expectNonEmptyString(object.provider, `${path}.provider`);
  if (provider !== "github" && provider !== "gitlab" && provider !== "bitbucket") {
    invalid(`${path}.provider`, "must be github, gitlab, or bitbucket");
  }
  return {
    canonicalUrl,
    owner: expectNonEmptyString(object.owner, `${path}.owner`),
    provider,
    repo: expectNonEmptyString(object.repo, `${path}.repo`),
  };
}

export function parseProviderRelease(value: unknown, path: string): ReleaseLedgerProviderRelease {
  const object = expectObject(value, path);
  return {
    notes: expectString(object.notes, `${path}.notes`),
    tag: expectNonEmptyString(object.tag, `${path}.tag`),
    title: expectNonEmptyString(object.title, `${path}.title`),
  };
}

export function transitionOperation(
  operation: ReleaseLedgerOperation,
  state: ReleaseOperationState,
  timestamp: string,
): ReleaseLedgerOperation {
  if (!isOperationState(state)) throw new ReleaseLedgerError(`Unknown release operation state ${String(state)}`);
  if (operation.state === state) return operation;
  if (operation.state === "pending" && state === "started") return { startedAt: timestamp, state };
  if (operation.state === "started" && state === "completed") {
    return { completedAt: timestamp, startedAt: operation.startedAt, state };
  }
  throw new ReleaseLedgerError(`Invalid release operation transition from ${operation.state} to ${state}`);
}

export function assertCompletionReady(data: ReleaseLedgerData): void {
  if (!data.tagsReady) {
    throw new ReleaseLedgerError(`Cannot complete release ${data.id}: local release tags are not ready`);
  }
  for (const [packageName, operation] of Object.entries(data.operations.npm)) {
    if (operation.state !== "completed") {
      throw new ReleaseLedgerError(
        `Cannot complete release ${data.id}: npm operation for ${packageName} is ${operation.state}`,
      );
    }
    if (!data.artifacts[packageName]) {
      throw new ReleaseLedgerError(`Cannot complete release ${data.id}: npm artifact for ${packageName} is missing`);
    }
    if (!data.operations.npmRegistries[packageName]) {
      throw new ReleaseLedgerError(`Cannot complete release ${data.id}: npm registry for ${packageName} is missing`);
    }
  }

  if ((data.options.push || (data.options.publishOnly && data.options.tags)) && !data.operations.push) {
    throw new ReleaseLedgerError(`Cannot complete release ${data.id}: push operation is not configured`);
  }
  if (data.operations.push && data.operations.push.state !== "completed") {
    throw new ReleaseLedgerError(`Cannot complete release ${data.id}: push operation is ${data.operations.push.state}`);
  }

  if (data.options.createRelease) {
    for (const pkg of data.packages) {
      const operation = data.operations.providerReleases[pkg.name];
      if (!operation) {
        throw new ReleaseLedgerError(
          `Cannot complete release ${data.id}: provider release for ${pkg.name} is not configured`,
        );
      }
      if (operation.state !== "completed") {
        throw new ReleaseLedgerError(
          `Cannot complete release ${data.id}: provider release for ${pkg.name} is ${operation.state}`,
        );
      }
    }
  }
}

export function validateDryRun(value: unknown): false {
  if (value !== false) invalid("options.dryRun", "durable ledgers require dryRun to be false");
  return false;
}

export function normalizeRegistryUrl(value: unknown, path: string): string {
  const registry = expectNonEmptyString(value, path);
  let url: URL;
  try {
    url = new URL(registry);
  } catch {
    invalid(path, "must be an absolute HTTP or HTTPS URL");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    invalid(path, "must be a credential-free HTTP or HTTPS URL");
  }
  return url.href;
}

function validateOperationWindow(
  operation: ReleaseLedgerOperation,
  createdAt: string,
  updatedAt: string,
  path: string,
): void {
  if (operation.state === "pending") return;
  const started = Date.parse(operation.startedAt);
  if (started < Date.parse(createdAt) || started > Date.parse(updatedAt)) {
    invalid(`${path}.startedAt`, "must be between createdAt and updatedAt");
  }
  if (operation.state === "completed") {
    const completed = Date.parse(operation.completedAt);
    if (completed < started || completed > Date.parse(updatedAt)) {
      invalid(`${path}.completedAt`, "must be between startedAt and updatedAt");
    }
  }
}

function parseExactRef(value: unknown, path: string): string {
  const ref = expectNonEmptyString(value, path);
  if (!ref.startsWith("refs/") || ref.includes("..") || ref.includes("//") || /[\s~^:?*[\\]/.test(ref)) {
    invalid(path, "must be an exact full git ref");
  }
  return ref;
}

function parseEnum<T extends string>(value: unknown, values: readonly T[], path: string, label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid(path, `unknown ${label} ${String(value)}`);
  return value as T;
}

export function isReleasePhase(value: string): value is ReleasePhase {
  return RELEASE_PHASES.includes(value as ReleasePhase);
}

function isOperationState(value: string): value is ReleaseOperationState {
  return OPERATION_STATES.includes(value as ReleaseOperationState);
}

function expectObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, "must be an object");
  return value as JsonObject;
}

function expectKeys(object: JsonObject, required: readonly string[], optional: readonly string[], path: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(object, key)) invalid(path, `missing required key ${key}`);
  }
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) invalid(path, `unknown key ${key}`);
  }
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "must be a boolean");
  return value;
}

function expectTimestamp(value: unknown, path: string): string {
  const timestamp = expectNonEmptyString(value, path);
  if (!isCanonicalTimestamp(timestamp)) invalid(path, "must be a canonical ISO timestamp");
  return timestamp;
}

export function expectGitOid(value: unknown, path: string): string {
  const oid = expectNonEmptyString(value, path);
  if (!FULL_GIT_OID_PATTERN.test(oid)) invalid(path, "must be a full 40- or 64-character git object ID");
  return oid;
}

function parseNonEmptyStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  return value.map((entry, index) => expectNonEmptyString(entry, `${path}[${index}]`));
}

export function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export function createStringRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function setRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { configurable: true, enumerable: true, value, writable: true });
}
