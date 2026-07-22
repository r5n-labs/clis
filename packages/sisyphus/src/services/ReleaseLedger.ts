import { createHash, randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readFile, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { StoneJson } from "../domain";

export const RELEASE_LEDGER_SCHEMA_VERSION = 1 as const;

const RELEASE_PHASES = ["planned", "local-ready", "external", "completed"] as const;
const OPERATION_STATES = ["pending", "started", "completed"] as const;
const RELEASE_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z_-]*$/;
const FULL_GIT_OID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const INTEGRITY_PATTERN = /^sha512-[0-9A-Za-z+/]{86}==$/;
const REMOTE_NAME_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._/-]*$/;
const WRITE_LOCK_OWNER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WRITE_LOCK_SCHEMA_VERSION = 1 as const;
const WRITE_LOCK_ACQUIRE_ATTEMPTS = 3;

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
  options: {
    changelog: boolean;
    createRelease: boolean;
    dryRun: boolean;
    npm: boolean;
    npmTag: string;
    publishOnly: boolean;
    push: boolean;
    tags: boolean;
  };
  packages: readonly ReleaseLedgerPackageInput[];
  stones: readonly ReleaseLedgerStoneInput[];
};

type LedgerPaths = {
  repositoryRoot: string;
  releaseDirectory: string;
  activePath: string;
  artifactsRoot: string;
  historyDirectory: string;
  removingPath: string;
};

type JsonObject = Record<string, unknown>;

type WriteLockMetadata = {
  schemaVersion: typeof WRITE_LOCK_SCHEMA_VERSION;
  ownerId: string;
  hostname: string;
  pid: number;
  acquiredAt: string;
};

type LedgerWriteLock = { lockPath: string; metadata: WriteLockMetadata; ownerPath: string };

type StaleWriteLock = {
  lockPath: string;
  lockStat: Awaited<ReturnType<typeof lstat>>;
  metadata: WriteLockMetadata;
  ownerPath: string;
};

export class ReleaseLedgerError extends Error {
  readonly _tag = "ReleaseLedgerError";
}

export class ReleaseLedger {
  readonly releaseDirectory: string;
  readonly artifactsDirectory: string;
  readonly activePath: string;

  private active = true;

  private constructor(
    private value: ReleaseLedgerData,
    private readonly paths: LedgerPaths,
  ) {
    this.releaseDirectory = paths.releaseDirectory;
    this.artifactsDirectory = getArtifactsDirectory(paths, value.id);
    this.activePath = paths.activePath;
  }

  static async create(input: CreateReleaseLedgerInput, cwd: string = process.cwd()): Promise<ReleaseLedger> {
    const paths = await resolveLedgerPaths(cwd);
    if (await pathExists(paths.activePath)) {
      throw new ReleaseLedgerError(`Cannot create release ledger: active ledger already exists at ${paths.activePath}`);
    }
    if (await pathExists(paths.removingPath)) {
      throw new ReleaseLedgerError(
        `Cannot create release ledger: previous cleanup is incomplete at ${paths.removingPath}`,
      );
    }

    const timestamp = new Date().toISOString();
    const baseCommitResult = await Bun.$`git rev-parse HEAD`.cwd(paths.repositoryRoot).quiet().nothrow();
    const baseCommit = baseCommitResult.stdout.toString().trim();
    if (baseCommitResult.exitCode !== 0 || !FULL_GIT_OID_PATTERN.test(baseCommit)) {
      throw new ReleaseLedgerError("Cannot create release ledger: failed to resolve the current commit");
    }
    const expectedReleaseTree = input.options.publishOnly
      ? await resolveCommitTree(paths.repositoryRoot, baseCommit)
      : undefined;
    const packages = serializePackages(input.packages);
    const stones = serializeStones(input.stones);
    const id = validateReleaseId(
      input.id ??
        createHash("sha256")
          .update(JSON.stringify({ baseCommit, options: input.options, packages, stones }))
          .digest("hex"),
      "create.id",
    );
    const npm = createStringRecord<ReleaseLedgerOperation>();
    const releaseTags = input.options.tags ? packages.map((pkg) => `${pkg.name}@${pkg.newVersion}`).sort() : [];

    if (input.options.npm) {
      for (const pkg of packages) {
        if (!pkg.isPrivate) setRecordValue(npm, pkg.name, { state: "pending" });
      }
    }

    const candidate: ReleaseLedgerData = {
      artifacts: createStringRecord<ReleaseLedgerArtifact>(),
      baseCommit,
      createdAt: timestamp,
      id,
      operations: {
        npm,
        npmRegistries: createStringRecord<string>(),
        providerReleases: createStringRecord<ReleaseLedgerProviderReleaseOperation>(),
      },
      options: {
        changelog: input.options.changelog,
        createRelease: input.options.createRelease,
        dryRun: validateDryRun(input.options.dryRun),
        npm: input.options.npm,
        npmTag: expectNonEmptyString(input.options.npmTag, "create.options.npmTag"),
        publishOnly: input.options.publishOnly,
        push: input.options.push,
        tags: input.options.tags,
      },
      packages,
      phase: "planned",
      releaseTags,
      schemaVersion: RELEASE_LEDGER_SCHEMA_VERSION,
      stones,
      tagsReady: !input.options.tags,
      updatedAt: timestamp,
    };
    if (expectedReleaseTree) candidate.expectedReleaseTree = expectedReleaseTree;
    const data = parseLedgerData(candidate, paths);
    await validatePackageFiles(data, paths);

    await ensureLedgerStorage(paths, id);
    if (await pathExists(paths.activePath)) {
      throw new ReleaseLedgerError(`Cannot create release ledger: active ledger already exists at ${paths.activePath}`);
    }
    const historyPath = getHistoryPath(paths, id);
    if (await pathExists(historyPath)) {
      throw new ReleaseLedgerError(`Release ${id} is already completed at ${historyPath}`);
    }
    await atomicWriteJson(paths.activePath, data, false);
    return new ReleaseLedger(data, paths);
  }

  static async loadActive(cwd: string = process.cwd()): Promise<ReleaseLedger | null> {
    const paths = await resolveLedgerPaths(cwd);
    let activeStat: Awaited<ReturnType<typeof lstat>>;

    try {
      activeStat = await lstat(paths.activePath);
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        if (await pathExists(paths.removingPath)) {
          throw new ReleaseLedgerError(`Release cleanup is incomplete at ${paths.removingPath}`);
        }
        return null;
      }
      throw new ReleaseLedgerError(
        `Failed to inspect active release ledger at ${paths.activePath}: ${errorDetail(error)}`,
      );
    }

    if (!activeStat.isFile() || activeStat.isSymbolicLink()) {
      throw new ReleaseLedgerError(`Invalid active release ledger at ${paths.activePath}: expected a regular file`);
    }

    let content: string;
    try {
      content = await readFile(paths.activePath, "utf-8");
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return null;
      throw new ReleaseLedgerError(
        `Failed to read active release ledger at ${paths.activePath}: ${errorDetail(error)}`,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch (error) {
      throw new ReleaseLedgerError(
        `Failed to parse active release ledger at ${paths.activePath}: ${errorDetail(error)}`,
      );
    }

    const data = parseLedgerData(raw, paths);
    await validatePackageFiles(data, paths);
    await ensureLedgerStorage(paths, data.id, false);
    await validateArtifactFiles(data, paths);
    return new ReleaseLedger(data, paths);
  }

  get data(): ReleaseLedgerData {
    return structuredClone(this.value);
  }

  get id(): string {
    return this.value.id;
  }

  get phase(): ReleasePhase {
    return this.value.phase;
  }

  async save(): Promise<void> {
    this.assertActive("save");
    await this.persist(structuredClone(this.value));
  }

  async setPhase(phase: ReleasePhase): Promise<void> {
    this.assertActive("set phase");
    if (phase === "completed") {
      throw new ReleaseLedgerError("Cannot set release phase to completed: use complete() instead");
    }
    if (!isReleasePhase(phase))
      throw new ReleaseLedgerError(`Cannot set release phase: unknown phase ${String(phase)}`);
    if (phase === this.value.phase) return;

    const currentIndex = RELEASE_PHASES.indexOf(this.value.phase);
    const nextIndex = RELEASE_PHASES.indexOf(phase);
    if (nextIndex < currentIndex) {
      throw new ReleaseLedgerError(`Cannot move release phase backwards from ${this.value.phase} to ${phase}`);
    }

    const next = structuredClone(this.value);
    next.phase = phase;
    await this.persist(next);
  }

  async setReleaseCommit(commit: string): Promise<void> {
    this.assertActive("set release commit");
    const normalized = expectGitOid(commit, "releaseCommit");
    if (this.value.releaseCommit === normalized) return;
    if (this.value.releaseCommit) {
      throw new ReleaseLedgerError(
        `Cannot replace release commit ${this.value.releaseCommit} with ${normalized} in release ${this.value.id}`,
      );
    }

    const next = structuredClone(this.value);
    next.releaseCommit = normalized;
    await this.persist(next);
  }

  async setExpectedReleaseTree(tree: string): Promise<void> {
    this.assertActive("set expected release tree");
    const normalized = expectGitOid(tree, "expectedReleaseTree");
    if (this.value.expectedReleaseTree === normalized) return;
    if (this.value.expectedReleaseTree) {
      throw new ReleaseLedgerError(
        `Cannot replace expected release tree ${this.value.expectedReleaseTree} with ${normalized} in release ${this.value.id}`,
      );
    }
    if (this.value.releaseCommit) {
      throw new ReleaseLedgerError(`Cannot set expected release tree after release commit ${this.value.releaseCommit}`);
    }

    const next = structuredClone(this.value);
    next.expectedReleaseTree = normalized;
    await this.persist(next);
  }

  async markTagsReady(): Promise<void> {
    this.assertActive("mark release tags ready");
    if (!this.value.options.tags) return;
    if (!this.value.releaseCommit)
      throw new ReleaseLedgerError("Cannot mark release tags ready without a release commit");
    if (this.value.tagsReady) return;

    const next = structuredClone(this.value);
    next.tagsReady = true;
    await this.persist(next);
  }

  async setArtifact(packageName: string, sourceArtifactPath: string): Promise<ReleaseLedgerArtifact> {
    this.assertActive("set artifact");
    const pkg = this.getPackage(packageName);
    if (pkg.isPrivate) throw new ReleaseLedgerError(`Cannot store an artifact for private package ${packageName}`);
    const npmOperation = this.value.operations.npm[packageName];
    if (!npmOperation)
      throw new ReleaseLedgerError(`Cannot store an artifact for unconfigured npm package ${packageName}`);
    if (npmOperation.state !== "pending") {
      throw new ReleaseLedgerError(`Cannot replace artifact for ${packageName} after its npm operation has started`);
    }
    if (extname(sourceArtifactPath) !== ".tgz") {
      throw new ReleaseLedgerError(`Cannot store artifact for ${packageName}: source must be a .tgz file`);
    }

    let sourceStat: Awaited<ReturnType<typeof stat>>;
    try {
      sourceStat = await stat(sourceArtifactPath);
    } catch (error) {
      throw new ReleaseLedgerError(
        `Cannot read source artifact for ${packageName} at ${sourceArtifactPath}: ${errorDetail(error)}`,
      );
    }
    if (!sourceStat.isFile()) {
      throw new ReleaseLedgerError(`Cannot store artifact for ${packageName}: source is not a regular file`);
    }

    await ensureLedgerStorage(this.paths, this.value.id, false);
    const destination = getArtifactPath(this.paths, this.value.id, packageName);
    const tempPath = join(this.artifactsDirectory, `.${randomUUID()}.tgz.tmp`);
    let integrity: string | undefined;

    try {
      await copyFile(sourceArtifactPath, tempPath, FS_CONSTANTS.COPYFILE_EXCL);
      await syncFile(tempPath);
      await assertArtifactPathSafe(this.paths, this.value.id, tempPath);
      integrity = await calculateIntegrity(tempPath);
      try {
        await link(tempPath, destination);
      } catch (error) {
        if (!isErrorCode(error, "EEXIST")) throw error;
        await assertArtifactPathSafe(this.paths, this.value.id, destination);
        if ((await calculateIntegrity(destination)) !== integrity) {
          throw new ReleaseLedgerError(`A different durable artifact already exists for ${packageName}`);
        }
      }
      await rm(tempPath, { force: true });
      await syncDirectory(this.artifactsDirectory);
      await assertArtifactPathSafe(this.paths, this.value.id, destination);
    } catch (error) {
      await cleanupAfterFailure(tempPath, error, `Failed to clean temporary artifact for ${packageName}`);
    }

    if (!integrity) throw new ReleaseLedgerError(`Failed to calculate artifact integrity for ${packageName}`);
    const artifact = { integrity, path: relative(this.releaseDirectory, destination).split(sep).join("/") };
    const next = structuredClone(this.value);
    setRecordValue(next.artifacts, packageName, artifact);
    await this.persist(next);
    return { ...artifact };
  }

  resolveArtifactPath(packageName: string): string {
    const artifact = this.value.artifacts[packageName];
    if (!artifact) throw new ReleaseLedgerError(`Release artifact is not configured for ${packageName}`);
    return resolve(this.releaseDirectory, artifact.path);
  }

  async configurePush(
    remote: string,
    destination: ReleaseLedgerRemoteDestination,
    refs: readonly ReleaseLedgerPushRef[],
  ): Promise<void> {
    this.assertActive("configure push");
    if (!this.value.options.push && !this.value.options.tags) {
      throw new ReleaseLedgerError("Cannot configure push: neither push nor tags are enabled for this release");
    }

    const configuration = parsePushConfiguration({ destination, refs, remote }, "configurePush");
    const existing = this.value.operations.push;
    if (existing) {
      if (samePushConfiguration(existing, configuration)) return;
      throw new ReleaseLedgerError("Cannot replace an existing push configuration");
    }

    const next = structuredClone(this.value);
    next.operations.push = { ...configuration, state: "pending" };
    await this.persist(next);
  }

  async configureProviderRelease(packageName: string, release: ReleaseLedgerProviderRelease): Promise<void> {
    this.assertActive("configure provider release");
    this.getPackage(packageName);
    if (!this.value.options.createRelease) {
      throw new ReleaseLedgerError("Cannot configure a provider release when createRelease is disabled");
    }

    const configuration = parseProviderRelease(release, `providerReleases.${packageName}`);
    const existing = this.value.operations.providerReleases[packageName];
    if (existing) {
      if (sameProviderConfiguration(existing, configuration)) return;
      throw new ReleaseLedgerError(`Cannot replace provider release configuration for ${packageName}`);
    }

    const next = structuredClone(this.value);
    setRecordValue(next.operations.providerReleases, packageName, { ...configuration, state: "pending" });
    await this.persist(next);
  }

  async markNpm(packageName: string, state: ReleaseOperationState): Promise<void> {
    this.assertActive("mark npm operation");
    const operation = this.value.operations.npm[packageName];
    if (!operation) throw new ReleaseLedgerError(`Npm operation is not configured for package ${packageName}`);
    if (operation.state === state) return;
    if (state === "started" && !this.value.artifacts[packageName]) {
      throw new ReleaseLedgerError(`Cannot start npm operation for ${packageName} without a durable artifact`);
    }

    const next = structuredClone(this.value);
    setRecordValue(next.operations.npm, packageName, transitionOperation(operation, state, this.operationTimestamp()));
    await this.persist(next);
  }

  async setNpmRegistry(packageName: string, registry: string): Promise<void> {
    this.assertActive("set npm registry");
    const operation = this.value.operations.npm[packageName];
    if (!operation) throw new ReleaseLedgerError(`Npm operation is not configured for package ${packageName}`);
    if (operation.state !== "pending") {
      throw new ReleaseLedgerError(`Cannot change npm registry for ${packageName} after publication has started`);
    }

    const normalized = normalizeRegistryUrl(registry, `operations.npmRegistries.${packageName}`);
    const existing = this.value.operations.npmRegistries[packageName];
    if (existing === normalized) return;
    if (existing) throw new ReleaseLedgerError(`Cannot replace npm registry for ${packageName}`);

    const next = structuredClone(this.value);
    setRecordValue(next.operations.npmRegistries, packageName, normalized);
    await this.persist(next);
  }

  async markPush(state: ReleaseOperationState): Promise<void> {
    this.assertActive("mark push operation");
    const operation = this.value.operations.push;
    if (!operation) throw new ReleaseLedgerError("Push operation is not configured");
    if (operation.state === state) return;

    const next = structuredClone(this.value);
    next.operations.push = {
      destination: operation.destination,
      refs: operation.refs,
      remote: operation.remote,
      ...transitionOperation(operation, state, this.operationTimestamp()),
    };
    await this.persist(next);
  }

  async markProviderRelease(packageName: string, state: ReleaseOperationState): Promise<void> {
    this.assertActive("mark provider release operation");
    const operation = this.value.operations.providerReleases[packageName];
    if (!operation) throw new ReleaseLedgerError(`Provider release is not configured for package ${packageName}`);
    if (operation.state === state) return;

    const next = structuredClone(this.value);
    setRecordValue(next.operations.providerReleases, packageName, {
      notes: operation.notes,
      tag: operation.tag,
      title: operation.title,
      ...transitionOperation(operation, state, this.operationTimestamp()),
    });
    await this.persist(next);
  }

  hasExternalProgress(): boolean {
    return hasExternalProgress(this.value);
  }

  async complete(): Promise<string> {
    this.assertActive("complete");
    let next = structuredClone(this.value);

    if (next.phase !== "completed") {
      assertCompletionReady(next);
      next.phase = "completed";
      await this.persist(next);
      next = this.value;
    }

    await ensureHistoryDirectory(this.paths);
    const historyPath = getHistoryPath(this.paths, next.id);
    if (await pathExists(historyPath)) {
      throw new ReleaseLedgerError(
        `Cannot complete release ${next.id}: history ledger already exists at ${historyPath}`,
      );
    }

    try {
      await rename(this.activePath, historyPath);
      await syncDirectory(this.paths.historyDirectory);
      await syncDirectory(this.releaseDirectory);
    } catch (error) {
      throw new ReleaseLedgerError(`Failed to move completed release ${next.id} to history: ${errorDetail(error)}`);
    }

    this.active = false;
    return historyPath;
  }

  async remove(): Promise<void> {
    this.assertActive("remove");
    const lock = await acquireLedgerWriteLock(this.releaseDirectory);

    try {
      await ensureLedgerStorage(this.paths, this.value.id, false);
      const current = parseLedgerData(JSON.parse(await readFile(this.activePath, "utf-8")), this.paths);
      await validatePackageFiles(current, this.paths);
      await validateArtifactFiles(current, this.paths);
      if (current.id !== this.value.id || current.updatedAt !== this.value.updatedAt) {
        throw new ReleaseLedgerError("Active release ledger changed in another process");
      }
      if (hasExternalProgress(current)) {
        throw new ReleaseLedgerError(`Cannot remove release ${current.id}: an external operation has started`);
      }

      await rename(this.activePath, this.paths.removingPath);
      await syncDirectory(this.releaseDirectory);
      await rm(this.artifactsDirectory, { force: true, recursive: true });
      await unlink(this.paths.removingPath);
      await syncDirectory(this.releaseDirectory);
    } catch (error) {
      throw new ReleaseLedgerError(`Failed to remove release ${this.value.id}: ${errorDetail(error)}`);
    } finally {
      await releaseLedgerWriteLock(lock);
    }

    this.active = false;
  }

  private async persist(candidate: ReleaseLedgerData): Promise<void> {
    candidate.updatedAt = nextTimestamp(this.value.updatedAt);
    const data = parseLedgerData(candidate, this.paths);
    await validatePackageFiles(data, this.paths);
    await validateArtifactFiles(data, this.paths);
    await atomicWriteJson(this.activePath, data, true, this.value.updatedAt);
    this.value = data;
  }

  private getPackage(packageName: string): ReleaseLedgerPackage {
    const pkg = this.value.packages.find((candidate) => candidate.name === packageName);
    if (!pkg) throw new ReleaseLedgerError(`Unknown release package ${packageName}`);
    return pkg;
  }

  private operationTimestamp(): string {
    return nextTimestamp(this.value.updatedAt);
  }

  private assertActive(operation: string): void {
    if (!this.active)
      throw new ReleaseLedgerError(`Cannot ${operation}: release ledger ${this.value.id} is no longer active`);
  }
}

async function resolveLedgerPaths(cwd: string): Promise<LedgerPaths> {
  const absoluteCwd = resolve(cwd);
  const rootResult = await Bun.$`git rev-parse --show-toplevel`.cwd(absoluteCwd).quiet().nothrow();
  if (rootResult.exitCode !== 0) {
    throw new ReleaseLedgerError(
      `Failed to resolve repository root from ${absoluteCwd}: ${rootResult.stderr.toString().trim() || "git exited unsuccessfully"}`,
    );
  }

  const rootOutput = rootResult.stdout.toString().trim();
  if (!rootOutput)
    throw new ReleaseLedgerError(`Failed to resolve repository root from ${absoluteCwd}: empty git output`);
  const repositoryRoot = isAbsolute(rootOutput) ? resolve(rootOutput) : resolve(absoluteCwd, rootOutput);
  const pathResult = await Bun.$`git rev-parse --git-path sisyphus/release`.cwd(repositoryRoot).quiet().nothrow();
  if (pathResult.exitCode !== 0) {
    throw new ReleaseLedgerError(
      `Failed to resolve release ledger git path from ${repositoryRoot}: ${pathResult.stderr.toString().trim() || "git exited unsuccessfully"}`,
    );
  }

  const pathOutput = pathResult.stdout.toString().trim();
  if (!pathOutput)
    throw new ReleaseLedgerError(`Failed to resolve release ledger git path from ${repositoryRoot}: empty git output`);
  const releaseDirectory = isAbsolute(pathOutput) ? resolve(pathOutput) : resolve(repositoryRoot, pathOutput);

  return {
    activePath: join(releaseDirectory, "active.json"),
    artifactsRoot: join(releaseDirectory, "artifacts"),
    historyDirectory: join(releaseDirectory, "history"),
    releaseDirectory,
    removingPath: join(releaseDirectory, "removing.json"),
    repositoryRoot,
  };
}

async function resolveCommitTree(repositoryRoot: string, commit: string): Promise<string> {
  const treeish = `${commit}^{tree}`;
  const result = await Bun.$`git rev-parse ${treeish}`.cwd(repositoryRoot).quiet().nothrow();
  const tree = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !FULL_GIT_OID_PATTERN.test(tree)) {
    throw new ReleaseLedgerError(`Cannot resolve release tree for commit ${commit}`);
  }
  return tree;
}

function hasExternalProgress(data: ReleaseLedgerData): boolean {
  if (Object.values(data.operations.npm).some((operation) => operation.state !== "pending")) return true;
  if (data.operations.push && data.operations.push.state !== "pending") return true;
  return Object.values(data.operations.providerReleases).some((operation) => operation.state !== "pending");
}

function serializePackages(inputs: readonly ReleaseLedgerPackageInput[]): ReleaseLedgerPackage[] {
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

function serializeStones(inputs: readonly ReleaseLedgerStoneInput[]): StoneJson[] {
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

function parseLedgerData(value: unknown, paths: LedgerPaths): ReleaseLedgerData {
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
  const phase = parsePhase(object.phase, "phase");
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
    if (
      !repositoryRelativePath ||
      repositoryRelativePath === ".." ||
      repositoryRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(repositoryRelativePath)
    ) {
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
    const expectedPath = relative(paths.releaseDirectory, getArtifactPath(paths, id, packageName))
      .split(sep)
      .join("/");
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
  const state = parseOperationState(object.state, `${path}.state`);

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

function parsePushConfiguration(
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
  if (url.username || url.password || url.search || url.hash) {
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

function parseProviderRelease(value: unknown, path: string): ReleaseLedgerProviderRelease {
  const object = expectObject(value, path);
  return {
    notes: expectString(object.notes, `${path}.notes`),
    tag: expectNonEmptyString(object.tag, `${path}.tag`),
    title: expectNonEmptyString(object.title, `${path}.title`),
  };
}

function transitionOperation(
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

function assertCompletionReady(data: ReleaseLedgerData): void {
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

async function ensureLedgerStorage(paths: LedgerPaths, id: string, create = true): Promise<void> {
  if (create) await mkdir(paths.releaseDirectory, { recursive: true });
  await assertDirectory(paths.releaseDirectory, "release directory");
  if (create) await mkdir(paths.artifactsRoot, { recursive: true });
  await assertDirectory(paths.artifactsRoot, "artifacts root");
  const artifactsDirectory = getArtifactsDirectory(paths, id);
  if (create) await mkdir(artifactsDirectory, { recursive: true });
  await assertDirectory(artifactsDirectory, `artifacts directory for release ${id}`);
  const realRelease = await realpath(paths.releaseDirectory);
  const realArtifactsRoot = await realpath(paths.artifactsRoot);
  const realArtifacts = await realpath(artifactsDirectory);
  assertContained(realRelease, realArtifactsRoot, "Artifacts root escapes the release directory");
  assertContained(realArtifactsRoot, realArtifacts, `Artifacts directory for release ${id} escapes the artifacts root`);
}

async function ensureHistoryDirectory(paths: LedgerPaths): Promise<void> {
  await assertDirectory(paths.releaseDirectory, "release directory");
  await mkdir(paths.historyDirectory, { recursive: true });
  await assertDirectory(paths.historyDirectory, "history directory");
  const realRelease = await realpath(paths.releaseDirectory);
  const realHistory = await realpath(paths.historyDirectory);
  assertContained(realRelease, realHistory, "History directory escapes the release directory");
}

async function validateArtifactFiles(data: ReleaseLedgerData, paths: LedgerPaths): Promise<void> {
  for (const [packageName, artifact] of Object.entries(data.artifacts)) {
    const artifactPath = resolve(paths.releaseDirectory, artifact.path);
    await assertArtifactPathSafe(paths, data.id, artifactPath);
    const integrity = await calculateIntegrity(artifactPath);
    if (integrity !== artifact.integrity) {
      throw new ReleaseLedgerError(`Invalid release ledger artifact for ${packageName}: sha512 integrity mismatch`);
    }
  }
}

async function validatePackageFiles(data: ReleaseLedgerData, paths: LedgerPaths): Promise<void> {
  const realRepositoryRoot = await realpath(paths.repositoryRoot);

  for (const pkg of data.packages) {
    const packagePath = resolve(paths.repositoryRoot, pkg.file);
    let packageStat: Awaited<ReturnType<typeof lstat>>;
    try {
      packageStat = await lstat(packagePath);
    } catch (error) {
      throw new ReleaseLedgerError(`Invalid package manifest for ${pkg.name} at ${pkg.file}: ${errorDetail(error)}`);
    }
    if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
      throw new ReleaseLedgerError(`Invalid package manifest for ${pkg.name} at ${pkg.file}: expected a regular file`);
    }

    const realPackagePath = await realpath(packagePath);
    assertContained(
      realRepositoryRoot,
      realPackagePath,
      `Package manifest for ${pkg.name} escapes the repository: ${pkg.file}`,
    );
  }
}

async function assertArtifactPathSafe(paths: LedgerPaths, id: string, artifactPath: string): Promise<void> {
  const artifactsDirectory = getArtifactsDirectory(paths, id);
  await assertDirectory(paths.releaseDirectory, "release directory");
  await assertDirectory(paths.artifactsRoot, "artifacts root");
  await assertDirectory(artifactsDirectory, `artifacts directory for release ${id}`);
  const realRelease = await realpath(paths.releaseDirectory);
  const realArtifactsRoot = await realpath(paths.artifactsRoot);
  const realArtifacts = await realpath(artifactsDirectory);
  assertContained(realRelease, realArtifactsRoot, "Artifacts root escapes the release directory");
  assertContained(realArtifactsRoot, realArtifacts, `Artifacts directory for release ${id} escapes the artifacts root`);
  let artifactStat: Awaited<ReturnType<typeof lstat>>;
  try {
    artifactStat = await lstat(artifactPath);
  } catch (error) {
    throw new ReleaseLedgerError(`Invalid release artifact at ${artifactPath}: ${errorDetail(error)}`);
  }
  if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
    throw new ReleaseLedgerError(`Invalid release artifact at ${artifactPath}: expected a regular file`);
  }
  const realArtifact = await realpath(artifactPath);
  assertContained(realArtifacts, realArtifact, `Release artifact escapes artifacts directory: ${artifactPath}`);
}

async function atomicWriteJson(
  path: string,
  data: ReleaseLedgerData,
  overwrite: boolean,
  expectedUpdatedAt?: string,
): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = join(dirname(path), `.${randomUUID()}.json.tmp`);
  const lock = await acquireLedgerWriteLock(dirname(path));

  try {
    await assertDirectory(dirname(path), "release directory");
    if (overwrite) {
      await assertRegularFile(path, "active release ledger");
      const current = JSON.parse(await readFile(path, "utf-8")) as { updatedAt?: unknown };
      if (current.updatedAt !== expectedUpdatedAt) {
        throw new ReleaseLedgerError("Active release ledger changed in another process");
      }
    }

    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (overwrite) {
      await rename(tempPath, path);
    } else {
      try {
        await link(tempPath, path);
      } catch (error) {
        if (isErrorCode(error, "EEXIST")) {
          throw new ReleaseLedgerError(`Cannot create release ledger: active ledger already exists at ${path}`);
        }
        throw error;
      }
      await unlink(tempPath);
    }
    await syncDirectory(dirname(path));
  } catch (error) {
    await cleanupAfterFailure(tempPath, error, `Failed to clean temporary ledger file at ${tempPath}`);
  } finally {
    await releaseLedgerWriteLock(lock);
  }
}

async function acquireLedgerWriteLock(directory: string): Promise<LedgerWriteLock> {
  const lockPath = join(directory, ".write.lock");

  for (let attempt = 0; attempt < WRITE_LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
    const metadata: WriteLockMetadata = {
      acquiredAt: new Date().toISOString(),
      hostname: hostname(),
      ownerId: randomUUID(),
      pid: process.pid,
      schemaVersion: WRITE_LOCK_SCHEMA_VERSION,
    };
    const ownerPath = getWriteLockOwnerPath(directory, metadata.ownerId);
    await writeLockOwner(ownerPath, metadata);

    try {
      await link(ownerPath, lockPath);
    } catch (error) {
      await rm(ownerPath, { force: true });
      if (!isErrorCode(error, "EEXIST")) {
        throw new ReleaseLedgerError(`Failed to acquire release ledger lock at ${lockPath}: ${errorDetail(error)}`);
      }
      const stale = await inspectStaleWriteLock(lockPath);
      if (!stale) continue;
      await recoverStaleWriteLock(stale);
      continue;
    }

    const lock = { lockPath, metadata, ownerPath };
    try {
      await syncDirectory(directory);
      return lock;
    } catch (error) {
      try {
        await releaseLedgerWriteLock(lock);
      } catch (releaseError) {
        throw new AggregateError([error, releaseError], `Failed to durably acquire release ledger lock at ${lockPath}`);
      }
      throw new ReleaseLedgerError(
        `Failed to durably acquire release ledger lock at ${lockPath}: ${errorDetail(error)}`,
      );
    }
  }

  throw new ReleaseLedgerError("Release ledger is locked by another process: lock changed during acquisition");
}

async function writeLockOwner(ownerPath: string, metadata: WriteLockMetadata): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(ownerPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf-8");
    await handle.sync();
  } catch (error) {
    await rm(ownerPath, { force: true });
    throw new ReleaseLedgerError(`Failed to create release ledger lock owner: ${errorDetail(error)}`);
  } finally {
    await handle?.close();
  }
}

async function inspectStaleWriteLock(lockPath: string): Promise<StaleWriteLock | null> {
  let lockStat: Awaited<ReturnType<typeof lstat>>;
  try {
    lockStat = await lstat(lockPath);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return null;
    throw new ReleaseLedgerError(`Failed to inspect release ledger lock at ${lockPath}: ${errorDetail(error)}`);
  }

  if (!lockStat.isFile() || lockStat.isSymbolicLink()) {
    throw new ReleaseLedgerError("Release ledger is locked by another process: lock owner is unknown");
  }

  let metadata: WriteLockMetadata | null = null;
  try {
    metadata = parseWriteLockMetadata(JSON.parse(await readFile(lockPath, "utf-8")));
  } catch {
    metadata = null;
  }
  if (!metadata) {
    throw new ReleaseLedgerError("Release ledger is locked by another process: lock metadata is malformed");
  }
  const ownerPath = getWriteLockOwnerPath(dirname(lockPath), metadata.ownerId);
  let ownerStat: Awaited<ReturnType<typeof lstat>>;
  try {
    ownerStat = await lstat(ownerPath);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      throw new ReleaseLedgerError("Release ledger is locked by another process: stale lock ownership is incomplete");
    }
    throw new ReleaseLedgerError(`Failed to inspect release ledger lock owner: ${errorDetail(error)}`);
  }

  if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) {
    throw new ReleaseLedgerError("Release ledger is locked by another process: stale lock ownership is invalid");
  }

  let ownerMetadata: WriteLockMetadata | null = null;
  try {
    ownerMetadata = parseWriteLockMetadata(JSON.parse(await readFile(ownerPath, "utf-8")));
  } catch {
    ownerMetadata = null;
  }
  if (!ownerMetadata || !sameWriteLockMetadata(metadata, ownerMetadata)) {
    throw new ReleaseLedgerError("Release ledger is locked by another process: stale lock ownership is invalid");
  }

  if (!sameFileIdentity(lockStat, ownerStat)) {
    return { lockPath, lockStat, metadata, ownerPath };
  }
  if (metadata.hostname !== hostname()) {
    throw new ReleaseLedgerError("Release ledger is locked by another process: lock owner is on an unknown host");
  }

  const liveness = getProcessLiveness(metadata.pid);
  if (liveness === "alive") {
    throw new ReleaseLedgerError("Release ledger is locked by another process: lock owner is still live");
  }
  if (liveness === "unknown") {
    throw new ReleaseLedgerError("Release ledger is locked by another process: lock owner liveness is unknown");
  }
  return { lockPath, lockStat, metadata, ownerPath };
}

async function recoverStaleWriteLock(stale: StaleWriteLock): Promise<void> {
  try {
    await unlink(stale.ownerPath);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return;
    throw new ReleaseLedgerError(`Failed to claim stale release ledger lock: ${errorDetail(error)}`);
  }

  let currentStat: Awaited<ReturnType<typeof lstat>>;
  try {
    currentStat = await lstat(stale.lockPath);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return;
    throw new ReleaseLedgerError(`Failed to verify stale release ledger lock: ${errorDetail(error)}`);
  }

  if (!sameFileIdentity(stale.lockStat, currentStat)) return;

  try {
    await unlink(stale.lockPath);
    await syncDirectory(dirname(stale.lockPath));
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return;
    throw new ReleaseLedgerError(`Failed to recover stale release ledger lock: ${errorDetail(error)}`);
  }
}

async function releaseLedgerWriteLock(lock: LedgerWriteLock): Promise<void> {
  let lockStat: Awaited<ReturnType<typeof lstat>>;
  let ownerStat: Awaited<ReturnType<typeof lstat>>;

  try {
    [lockStat, ownerStat] = await Promise.all([lstat(lock.lockPath), lstat(lock.ownerPath)]);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      await rm(lock.ownerPath, { force: true });
      throw new ReleaseLedgerError("Failed to release ledger write lock: ownership record is missing");
    }
    throw new ReleaseLedgerError(`Failed to inspect release ledger lock during release: ${errorDetail(error)}`);
  }

  if (!sameFileIdentity(lockStat, ownerStat)) {
    await rm(lock.ownerPath, { force: true });
    throw new ReleaseLedgerError("Failed to release ledger write lock: ownership changed");
  }

  let currentMetadata: WriteLockMetadata | null = null;
  try {
    currentMetadata = parseWriteLockMetadata(JSON.parse(await readFile(lock.lockPath, "utf-8")));
  } catch {
    currentMetadata = null;
  }
  if (currentMetadata?.ownerId !== lock.metadata.ownerId) {
    throw new ReleaseLedgerError("Failed to release ledger write lock: owner identity changed");
  }

  try {
    await unlink(lock.lockPath);
    await unlink(lock.ownerPath);
    await syncDirectory(dirname(lock.lockPath));
  } catch (error) {
    throw new ReleaseLedgerError(`Failed to release ledger write lock: ${errorDetail(error)}`);
  }
}

function parseWriteLockMetadata(value: unknown): WriteLockMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (
    keys.length !== 5 ||
    !keys.every((key) => ["acquiredAt", "hostname", "ownerId", "pid", "schemaVersion"].includes(key)) ||
    object.schemaVersion !== WRITE_LOCK_SCHEMA_VERSION ||
    typeof object.ownerId !== "string" ||
    !WRITE_LOCK_OWNER_ID_PATTERN.test(object.ownerId) ||
    typeof object.hostname !== "string" ||
    !object.hostname ||
    typeof object.pid !== "number" ||
    !Number.isSafeInteger(object.pid) ||
    object.pid <= 0 ||
    typeof object.acquiredAt !== "string" ||
    !isCanonicalTimestamp(object.acquiredAt)
  ) {
    return null;
  }
  return {
    acquiredAt: object.acquiredAt,
    hostname: object.hostname,
    ownerId: object.ownerId,
    pid: object.pid,
    schemaVersion: WRITE_LOCK_SCHEMA_VERSION,
  };
}

function getWriteLockOwnerPath(directory: string, ownerId: string): string {
  if (!WRITE_LOCK_OWNER_ID_PATTERN.test(ownerId)) {
    throw new ReleaseLedgerError("Release ledger is locked by another process: lock owner identity is malformed");
  }
  return join(directory, `.write.lock.${ownerId}.owner`);
}

function getProcessLiveness(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return isErrorCode(error, "ESRCH") ? "dead" : "unknown";
  }
}

function sameFileIdentity(
  first: Awaited<ReturnType<typeof lstat>>,
  second: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function sameWriteLockMetadata(first: WriteLockMetadata, second: WriteLockMetadata): boolean {
  return (
    first.schemaVersion === second.schemaVersion &&
    first.ownerId === second.ownerId &&
    first.hostname === second.hostname &&
    first.pid === second.pid &&
    first.acquiredAt === second.acquiredAt
  );
}

function isCanonicalTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

async function cleanupAfterFailure(path: string, error: unknown, message: string): Promise<never> {
  try {
    await rm(path, { force: true });
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], message);
  }
  throw error;
}

async function calculateIntegrity(path: string): Promise<string> {
  let content: Buffer;
  try {
    content = await readFile(path);
  } catch (error) {
    throw new ReleaseLedgerError(`Failed to read release artifact at ${path}: ${errorDetail(error)}`);
  }
  return `sha512-${createHash("sha512").update(content).digest("base64")}`;
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertDirectory(path: string, label: string): Promise<void> {
  let pathStat: Awaited<ReturnType<typeof lstat>>;
  try {
    pathStat = await lstat(path);
  } catch (error) {
    throw new ReleaseLedgerError(`Invalid ${label} at ${path}: ${errorDetail(error)}`);
  }
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
    throw new ReleaseLedgerError(`Invalid ${label} at ${path}: expected a real directory`);
  }
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  let pathStat: Awaited<ReturnType<typeof lstat>>;
  try {
    pathStat = await lstat(path);
  } catch (error) {
    throw new ReleaseLedgerError(`Invalid ${label} at ${path}: ${errorDetail(error)}`);
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new ReleaseLedgerError(`Invalid ${label} at ${path}: expected a regular file`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function getArtifactsDirectory(paths: LedgerPaths, id: string): string {
  return resolve(paths.artifactsRoot, validateReleaseId(id, "id"));
}

function getArtifactPath(paths: LedgerPaths, id: string, packageName: string): string {
  const filename = `${createHash("sha256").update(packageName).digest("hex")}.tgz`;
  return resolve(getArtifactsDirectory(paths, id), filename);
}

function getHistoryPath(paths: LedgerPaths, id: string): string {
  const path = resolve(paths.historyDirectory, `${validateReleaseId(id, "id")}.json`);
  if (dirname(path) !== resolve(paths.historyDirectory)) {
    throw new ReleaseLedgerError(`Invalid release history path for ID ${id}`);
  }
  return path;
}

function validateDryRun(value: unknown): false {
  if (value !== false) invalid("options.dryRun", "durable ledgers require dryRun to be false");
  return false;
}

function validateReleaseId(value: unknown, path: string): string {
  const id = expectNonEmptyString(value, path);
  if (!RELEASE_ID_PATTERN.test(id)) invalid(path, `invalid release ID ${id}`);
  return id;
}

function normalizeRegistryUrl(value: unknown, path: string): string {
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

function parsePhase(value: unknown, path: string): ReleasePhase {
  if (typeof value !== "string" || !isReleasePhase(value)) invalid(path, `unknown release phase ${String(value)}`);
  return value;
}

function parseOperationState(value: unknown, path: string): ReleaseOperationState {
  if (typeof value !== "string" || !isOperationState(value)) invalid(path, `unknown operation state ${String(value)}`);
  return value;
}

function isReleasePhase(value: string): value is ReleasePhase {
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

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path, "must be a string");
  return value;
}

function expectNonEmptyString(value: unknown, path: string): string {
  const string = expectString(value, path);
  if (!string.trim()) invalid(path, "must be nonempty");
  return string;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "must be a boolean");
  return value;
}

function expectTimestamp(value: unknown, path: string): string {
  const timestamp = expectNonEmptyString(value, path);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== timestamp) {
    invalid(path, "must be a canonical ISO timestamp");
  }
  return timestamp;
}

function expectGitOid(value: unknown, path: string): string {
  const oid = expectNonEmptyString(value, path);
  if (!FULL_GIT_OID_PATTERN.test(oid)) invalid(path, "must be a full 40- or 64-character git object ID");
  return oid;
}

function parseNonEmptyStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  return value.map((entry, index) => expectNonEmptyString(entry, `${path}[${index}]`));
}

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

function samePushConfiguration(
  existing: ReleaseLedgerPushOperation,
  configuration: { destination: ReleaseLedgerRemoteDestination; remote: string; refs: ReleaseLedgerPushRef[] },
): boolean {
  if (
    existing.remote !== configuration.remote ||
    JSON.stringify(existing.destination) !== JSON.stringify(configuration.destination) ||
    existing.refs.length !== configuration.refs.length
  ) {
    return false;
  }
  return existing.refs.every((ref, index) => {
    const other = configuration.refs[index];
    return other?.source === ref.source && other.destination === ref.destination && other.oid === ref.oid;
  });
}

function sameProviderConfiguration(
  existing: ReleaseLedgerProviderReleaseOperation,
  configuration: ReleaseLedgerProviderRelease,
): boolean {
  return (
    existing.tag === configuration.tag &&
    existing.title === configuration.title &&
    existing.notes === configuration.notes
  );
}

function assertContained(base: string, candidate: string, message: string): void {
  const path = relative(base, candidate);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new ReleaseLedgerError(message);
  }
}

function createStringRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function setRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { configurable: true, enumerable: true, value, writable: true });
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalid(path: string, detail: string): never {
  throw new ReleaseLedgerError(`Invalid release ledger at ${path}: ${detail}`);
}
