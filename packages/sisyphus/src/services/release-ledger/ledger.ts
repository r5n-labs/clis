import { createHash, randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { copyFile, link, lstat, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  assertArtifactPathSafe,
  atomicWriteJson,
  calculateIntegrity,
  cleanupAfterFailure,
  ensureHistoryDirectory,
  ensureLedgerStorage,
  getArtifactPath,
  getArtifactRelativePath,
  getArtifactsDirectory,
  getHistoryPath,
  pathExists,
  resolveCommitTree,
  resolveLedgerPaths,
  validateArtifactFiles,
  validatePackageFiles,
} from "./storage";
import type {
  CreateReleaseLedgerInput,
  LedgerPaths,
  ReleaseLedgerArtifact,
  ReleaseLedgerData,
  ReleaseLedgerOperation,
  ReleaseLedgerPackage,
  ReleaseLedgerProviderRelease,
  ReleaseLedgerProviderReleaseOperation,
  ReleaseLedgerPushRef,
  ReleaseLedgerRemoteDestination,
  ReleaseOperationState,
  ReleasePhase,
} from "./types";
import {
  errorDetail,
  expectNonEmptyString,
  FULL_GIT_OID_PATTERN,
  isErrorCode,
  RELEASE_LEDGER_SCHEMA_VERSION,
  RELEASE_PHASES,
  ReleaseLedgerError,
  validateReleaseId,
} from "./types";
import {
  assertCompletionReady,
  createStringRecord,
  expectGitOid,
  hasExternalProgress,
  isReleasePhase,
  nextTimestamp,
  normalizeRegistryUrl,
  parseLedgerData,
  parseProviderRelease,
  parsePushConfiguration,
  serializePackages,
  serializeStones,
  setRecordValue,
  transitionOperation,
  validateDryRun,
} from "./validate";
import { acquireLedgerWriteLock, releaseLedgerWriteLock, syncPath } from "./write-lock";

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
        `Cannot create release ledger: an interrupted removal left ${paths.removingPath}; delete it and its artifacts directory to finish cleanup`,
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
          throw new ReleaseLedgerError(
            `Release cleanup is incomplete: an interrupted removal left ${paths.removingPath}; delete it and its artifacts directory to finish cleanup`,
          );
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
    await ensureLedgerStorage(paths, data.id);
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
    if (!this.value.expectedReleaseTree) {
      throw new ReleaseLedgerError("Cannot set release commit before the expected release tree");
    }
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

    await ensureLedgerStorage(this.paths, this.value.id);
    const destination = getArtifactPath(this.paths, this.value.id, packageName);
    const tempPath = join(this.artifactsDirectory, `.${randomUUID()}.tgz.tmp`);
    let integrity: string | undefined;

    try {
      await copyFile(sourceArtifactPath, tempPath, FS_CONSTANTS.COPYFILE_EXCL);
      await syncPath(tempPath);
      await assertArtifactPathSafe(this.paths, this.value.id, tempPath);
      integrity = await calculateIntegrity(tempPath);
      try {
        await link(tempPath, destination);
      } catch (error) {
        if (!isErrorCode(error, "EEXIST")) throw error;
        await assertArtifactPathSafe(this.paths, this.value.id, destination);
        if ((await calculateIntegrity(destination)) !== integrity) {
          const detail = this.value.artifacts[packageName]
            ? `A different durable artifact already exists for ${packageName} at ${destination}`
            : `A different durable artifact already exists for ${packageName} at ${destination}; the ledger records no artifact for it, so it is likely left by an interrupted run - delete the file and retry`;
          throw new ReleaseLedgerError(detail);
        }
      }
      await rm(tempPath, { force: true });
      await syncPath(this.artifactsDirectory);
      await assertArtifactPathSafe(this.paths, this.value.id, destination);
    } catch (error) {
      await cleanupAfterFailure(tempPath, error, `Failed to clean temporary artifact for ${packageName}`);
    }

    if (!integrity) throw new ReleaseLedgerError(`Failed to calculate artifact integrity for ${packageName}`);
    const artifact = { integrity, path: getArtifactRelativePath(this.paths, this.value.id, packageName) };
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
      const sameConfiguration =
        JSON.stringify([existing.remote, existing.destination, existing.refs]) ===
        JSON.stringify([configuration.remote, configuration.destination, configuration.refs]);
      if (sameConfiguration) return;
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
      if (
        existing.tag === configuration.tag &&
        existing.title === configuration.title &&
        existing.notes === configuration.notes
      ) {
        return;
      }
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
      await syncPath(this.paths.historyDirectory);
      await syncPath(this.releaseDirectory);
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
      await ensureLedgerStorage(this.paths, this.value.id);
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
      await syncPath(this.releaseDirectory);
      await rm(this.artifactsDirectory, { force: true, recursive: true });
      await unlink(this.paths.removingPath);
      await syncPath(this.releaseDirectory);
    } catch (error) {
      if (error instanceof ReleaseLedgerError) throw error;
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
