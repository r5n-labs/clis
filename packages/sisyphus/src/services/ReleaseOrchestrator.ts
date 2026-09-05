import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type ConfigManager, Exit } from "@r5n/cli-core";
import { resolveNpmAccess } from "@r5n/tools/scripts/npm-access";
import { DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE, DEFAULT_NPM_TAG } from "../constants";
import { Package, Stone } from "../domain";
import { createGitProvider, type GitProvider } from "../providers";
import type { SisyphusConfig } from "../types";
import { ChangelogGenerator } from "./ChangelogGenerator";
import { createCommitUrl, GitRemoteParser } from "./GitRemoteParser";
import { PackageUpdater } from "./PackageUpdater";
import {
  type CatalogMap,
  extractCatalogs,
  type RootManifest,
  renderPublishManifest,
  type WorkspaceVersionMap,
  workspaceVersionsFromPackages,
} from "./PublishManifest";
import {
  assertBuildOutputsUntracked,
  cleanBuildOutputs,
  type ResolvedBuildConfig,
  resolveBuildConfig,
  runBuildCommand,
} from "./release/build-outputs";
import { formatCommitMessage, getChangelogFiles, getCommitAuthorArg, getCommitterEnv } from "./release/commit-meta";
import {
  getCommitTree,
  validateCommitParent,
  validateCommitTree,
  validateReleaseCommit,
  validateReleaseCommitCandidate,
  writeExpectedReleaseTree,
} from "./release/commit-tree";
import {
  getHeadCommit,
  getHeadReference,
  getOwnedMutationFingerprint,
  getPublishSourceStatus,
  normalizeOwnedPath,
  resolveRef,
  toLiteralPathspec,
  unstageOwnedPaths,
  updateRollbackRefs,
  validateOwnedPaths,
  validatePublishSources,
} from "./release/git-state";
import {
  packNpmArtifact,
  readPackedManifest,
  sameJsonDocument,
  stagePackageForPack,
  validateExistingPackInputs,
  validateRepositoryIgnoredInputs,
} from "./release/npm-pack";
import { reconcileNpmPublication } from "./release/npm-reconcile";
import {
  getPublishablePackages,
  getScopeRegistryArgs,
  resolveNpmRegistry,
  resolveReleaseNpmTag,
} from "./release/npm-registry";
import { reconcileReleasePush } from "./release/push-reconcile";
import { getProviderRelease } from "./release/release-notes";
import {
  getCurrentBranchName,
  getDestinationProvider,
  getSinglePushUrl,
  getValidatedPushUrl,
  performAtomicPush,
  resolvePushRemote,
  resolvePushTarget,
  resolveRemoteDestination,
  validatePushSources,
  verifyRemoteRefs,
} from "./release/remote-url";
import { runInContext } from "./release/run";
import {
  ReleaseLedger,
  type ReleaseLedgerData,
  type ReleaseLedgerProviderReleaseOperation,
  type ReleaseLedgerRemoteDestination,
} from "./release-ledger";
import { StoneManager } from "./StoneManager";
import { WorkspaceScanner } from "./WorkspaceScanner";

export { isValidNpmTag } from "./release/npm-registry";

export type ReleaseOptions = {
  changelog: boolean;
  createRelease: boolean;
  dryRun: boolean;
  npm: boolean;
  push: boolean;
  tags: boolean;
};

type PreparedNpmPackage = { artifactPath: string; pkg: Package };
type PreparedNpmPublish = { key: string; packages: PreparedNpmPackage[] };
type ResumeResult = { ledger: ReleaseLedgerData | null; packages: Package[]; stones: Stone[] };

export class ReleaseOrchestrator {
  private packageUpdater = new PackageUpdater();
  private changelogGenerator: ChangelogGenerator;
  private remoteParser = new GitRemoteParser();
  private stoneManager: StoneManager;
  private provider: GitProvider | null = null;
  private commitUrlFn: ((hash: string) => string) | null = null;
  private options: ReleaseOptions;
  private createdTags: string[] = [];
  private createdTagTargets = new Map<string, string>();
  private commitCreated = false;
  private createdCommit: { baseCommit: string; oid: string; ref: string | null } | null = null;
  private irreversibleOperation: string | null = null;
  private ownedPaths: string[] | null = null;
  private repositoryRoot: string | null = null;
  private rollbackBlockedReason: string | null = null;
  private ignoredBuildInputsValidated = false;
  private buildConfig: ResolvedBuildConfig | null = null;
  private buildOutputsPrepared = false;
  private preparedNpmPublish: PreparedNpmPublish | null = null;
  private ledger: ReleaseLedger | null = null;
  private publishContext: { catalogs: CatalogMap; workspaceVersions: WorkspaceVersionMap } | null = null;

  constructor(
    private config: ConfigManager<SisyphusConfig>,
    options: ReleaseOptions,
  ) {
    this.options = options;
    this.changelogGenerator = new ChangelogGenerator(this.config.get("changelog"));
    this.stoneManager = new StoneManager(this.config);
  }

  static async assertNoActiveRelease(): Promise<void> {
    const activeLedger = await ReleaseLedger.loadActive();
    if (!activeLedger) return;
    throw new Exit(`Release ${activeLedger.id} is incomplete`, "Run sis roll --resume before starting another release");
  }

  static async resume(config: ConfigManager<SisyphusConfig>): Promise<ResumeResult> {
    const ledger = await ReleaseLedger.loadActive();
    if (!ledger) {
      throw new Exit("No incomplete release found", "Run sis roll to start a release");
    }

    const data = ledger.data;
    const orchestrator = new ReleaseOrchestrator(config, data.options);
    orchestrator.ledger = ledger;
    const packages = data.packages.map(
      (pkg) =>
        new Package({
          file: pkg.file,
          isPrivate: pkg.isPrivate,
          name: pkg.name,
          newVersion: pkg.newVersion,
          version: pkg.oldVersion,
        }),
    );
    const stones = data.stones.map((stone) => Stone.fromJson(stone));
    orchestrator.createdTags = [...data.releaseTags];

    if (data.phase === "completed") {
      await ledger.complete();
      return { ledger: orchestrator.getLedgerSnapshot(), packages, stones };
    }

    try {
      await orchestrator.recoverReleaseCommit(data);
      await validateReleaseCommit(ledger.data);
      await orchestrator.ensureLedgerPlan(packages, stones);
      if (data.options.npm) {
        const needsArtifact = packages.some(
          (pkg) => ledger.data.operations.npm[pkg.name] && !ledger.data.artifacts[pkg.name],
        );
        if (needsArtifact) await validatePublishSources(await orchestrator.getRepositoryRoot());
        await orchestrator.prepareNpmPublish(packages);
      }
      if (ledger.phase === "planned") await ledger.setPhase("local-ready");
      await orchestrator.resumeExternalOperations(packages, stones);
      return { ledger: orchestrator.getLedgerSnapshot(), packages, stones };
    } catch (error) {
      if (error instanceof Exit || !orchestrator.hasCrossedIrreversibleBoundary()) throw error;
      throw orchestrator.createIncompleteReleaseError(error);
    }
  }

  async initializeExternalRelease(packages: Package[], stones: Stone[], publishOnly: boolean): Promise<void> {
    if (this.options.dryRun || !this.needsReleaseLedger(publishOnly)) return;

    this.ledger = await ReleaseLedger.create({
      options: {
        ...this.options,
        npmTag: this.options.npm ? resolveReleaseNpmTag(packages, this.config.get("tag")) : DEFAULT_NPM_TAG,
        publishOnly,
      },
      packages: packages.map((pkg) => ({
        file: pkg.file,
        isPrivate: pkg.isPrivate,
        name: pkg.name,
        newVersion: pkg.newVersion,
        version: pkg.version,
      })),
      stones,
    });
  }

  async finalizeExternalRelease(packages: Package[], stones: Stone[]): Promise<void> {
    if (!this.ledger) return;
    if (this.options.npm || this.ledger.data.options.publishOnly)
      await validatePublishSources(await this.getRepositoryRoot());
    const releaseCommit = await getHeadCommit();
    await this.ensureExpectedReleaseTree(this.ledger.data, releaseCommit);
    await validateReleaseCommitCandidate(this.ledger.data, releaseCommit);
    await this.ledger.setReleaseCommit(releaseCommit);
    await this.ensureLedgerPlan(packages, stones);
  }

  async markExternalReleaseReady(): Promise<void> {
    if (this.ledger) await this.ledger.setPhase("local-ready");
  }

  async completeRelease(): Promise<void> {
    if (this.ledger) await this.ledger.complete();
  }

  private async getProvider(): Promise<GitProvider> {
    if (!this.provider) {
      const destination = this.ledger?.data.operations.push?.destination;
      const info = getDestinationProvider(destination);
      this.provider = await createGitProvider(info);
    }
    return this.provider;
  }

  private async initCommitLinks(): Promise<void> {
    if (this.commitUrlFn !== null) return;
    const destination = this.ledger?.data.operations.push?.destination;
    const info = getDestinationProvider(destination);
    if (info) {
      this.commitUrlFn = createCommitUrl(info);
      return;
    }
    const remoteInfo = await this.remoteParser.getRemoteInfo();
    this.commitUrlFn = remoteInfo?.commitUrl ?? null;
  }

  async preflight(packages: Package[], stones: Stone[]): Promise<void> {
    if (this.options.dryRun) return;

    await ReleaseOrchestrator.assertNoActiveRelease();

    const ownedPaths = await this.getOwnedPaths(packages, stones);
    await validateOwnedPaths(ownedPaths, await this.getRepositoryRoot());
    const pathspecs = ownedPaths.map((path) => toLiteralPathspec(path));
    const result = await runInContext(
      () => Bun.$`git status --porcelain=v1 -z --untracked-files=all -- ${pathspecs}`.quiet(),
      "Failed to inspect release files",
    );

    if (result.stdout.length === 0) return;

    throw new Exit("Release files have uncommitted changes", `Commit or stash these files:\n${ownedPaths.join("\n")}`);
  }

  async updatePackageVersions(packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;
    await this.packageUpdater.updateAll(packages);
  }

  async generateChangelogs(stones: Stone[], packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;
    await this.changelogGenerator.generate(stones, packages);
  }

  async createCommit(stone: Stone, packages: Package[], originalStones: Stone[]): Promise<void> {
    if (this.options.dryRun) return;

    const ownedPaths = await this.getOwnedPaths(packages, originalStones);
    const pathspecs = ownedPaths.map((path) => toLiteralPathspec(path));
    const message = formatCommitMessage(this.config.get("commit").message, stone, packages);
    const authorArg = getCommitAuthorArg(this.config.get("commit"));
    const baseCommit = this.ledger?.data.baseCommit ?? (await getHeadCommit());
    const headReference = await getHeadReference();
    let expectedReleaseTree: string | undefined;
    let stagedState: string | undefined;

    try {
      await runInContext(() => Bun.$`git add -A -- ${pathspecs}`.quiet(), "Failed to stage release files");
      if ((await getHeadCommit()) !== baseCommit) {
        throw new Exit(
          "Release base commit changed before commit creation",
          "Restart the release from the intended branch",
        );
      }
      expectedReleaseTree = await writeExpectedReleaseTree(baseCommit, ownedPaths, await this.getRepositoryRoot());
      await this.ledger?.setExpectedReleaseTree(expectedReleaseTree);
      stagedState = await getOwnedMutationFingerprint(ownedPaths);
      await runInContext(
        () =>
          Bun.$`git commit --only ${authorArg} -m ${message} -- ${pathspecs}`
            .env(getCommitterEnv(this.config.get("commit")))
            .quiet(),
        "Failed to create commit",
      );
      this.commitCreated = true;
    } catch (error) {
      if (stagedState) {
        let currentState: string;
        try {
          currentState = await getOwnedMutationFingerprint(ownedPaths);
        } catch (inspectionError) {
          this.rollbackBlockedReason = "release files could not be verified after commit failure";
          throw new AggregateError([error, inspectionError], "Commit failed and release files could not be verified");
        }
        if (currentState !== stagedState) {
          this.rollbackBlockedReason = "release-owned files changed while commit hooks ran";
          throw new AggregateError([error], "Commit failed after a hook changed release-owned files");
        }
      }
      try {
        await unstageOwnedPaths(ownedPaths);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Commit and index cleanup failed");
      }
      throw error;
    }

    const releaseCommit = await getHeadCommit();
    this.createdCommit = { baseCommit, oid: releaseCommit, ref: headReference };
    if (!expectedReleaseTree) throw new Error("Expected release tree was not recorded before commit");
    if (this.ledger) {
      await validateReleaseCommitCandidate(this.ledger.data, releaseCommit);
      return;
    }

    await validateCommitParent(releaseCommit, baseCommit);
    await validateCommitTree(releaseCommit, expectedReleaseTree);
  }

  async createGitTags(packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;

    const target = await getHeadCommit();
    for (const pkg of packages) {
      const tagName = `${pkg.name}@${pkg.newVersion ?? pkg.version}`;
      await runInContext(
        () => Bun.$`git -c tag.gpgSign=false tag -- ${tagName}`.quiet(),
        `Failed to create tag ${tagName}`,
      );
      this.createdTags.push(tagName);
      this.createdTagTargets.set(tagName, target);
    }
  }

  async prepareNpmPublish(packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;

    const key = this.getPackageSetKey(packages);
    if (this.preparedNpmPublish?.key === key) return;

    const ledger = this.requireLedger("prepare npm artifacts");
    this.preparedNpmPublish = null;
    const publishablePackages = await getPublishablePackages(packages);
    if (publishablePackages.length === 0) {
      this.preparedNpmPublish = { key, packages: [] };
      return;
    }

    if (publishablePackages.some((pkg) => !ledger.data.artifacts[pkg.name])) {
      await this.prepareBuildOutputs();
    }

    const tempDir = await mkdtemp(join(tmpdir(), "sisyphus-publish-"));
    const preparedPackages: PreparedNpmPackage[] = [];

    try {
      for (const [index, pkg] of publishablePackages.entries()) {
        if (!ledger.data.artifacts[pkg.name]) {
          const artifactPath = join(tempDir, `${String(index).padStart(4, "0")}.tgz`);
          await runInContext(() => this.prepareNpmArtifact(pkg, artifactPath), `Failed to prepare ${pkg.name}`);
          await ledger.setArtifact(pkg.name, artifactPath);
        }
        const artifactPath = ledger.resolveArtifactPath(pkg.name);
        resolveNpmAccess(await readPackedManifest(artifactPath));
        preparedPackages.push({ artifactPath, pkg });
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
    this.preparedNpmPublish = { key, packages: preparedPackages };
  }

  async publishToNpm(packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;

    const key = this.getPackageSetKey(packages);
    if (this.preparedNpmPublish?.key !== key) {
      await this.prepareNpmPublish(packages);
    }

    const preparedPackages = this.preparedNpmPublish?.packages ?? [];
    if (preparedPackages.length === 0) return;

    try {
      for (const prepared of preparedPackages) {
        await this.publishPreparedPackage(prepared);
      }
    } finally {
      this.preparedNpmPublish = null;
    }
  }

  async pushRelease(): Promise<void> {
    if (this.options.dryRun) return;
    await this.pushConfiguredRefs();
  }

  async createGitRelease(stones: Stone[], packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;
    if (packages.length === 0) return;

    await this.initCommitLinks();
    const provider = await this.getProvider();
    const pushOperation = this.ledger?.data.operations.push;
    if (pushOperation) {
      const tagRefs = pushOperation.refs.filter((ref) => ref.destination.startsWith("refs/tags/"));
      if (tagRefs.length > 0) await verifyRemoteRefs(pushOperation, () => this.getRepositoryRoot(), tagRefs);
    }

    for (const pkg of packages) {
      const release = getProviderRelease(stones, pkg, this.commitUrlFn);
      await this.createProviderRelease(provider, pkg.name, release);
    }
  }

  hasCrossedIrreversibleBoundary(): boolean {
    return this.irreversibleOperation !== null || this.ledger?.hasExternalProgress() === true;
  }

  createIncompleteReleaseError(error: unknown): Exit {
    const operation = this.irreversibleOperation ?? "an external release operation";
    const releaseError = new Exit(
      `Release incomplete after ${operation} began`,
      "Local state preserved; run sis roll --resume to reconcile and continue.",
    );
    releaseError.cause = error;
    return releaseError;
  }

  async rollback(removeLedger = true): Promise<boolean> {
    if (this.hasCrossedIrreversibleBoundary()) return false;
    await this.validateRollbackState();

    this.preparedNpmPublish = null;
    await updateRollbackRefs(this.createdCommit, this.createdTags, this.createdTagTargets, () =>
      this.getRepositoryRoot(),
    );

    if (this.commitCreated) {
      if (this.ownedPaths) {
        await unstageOwnedPaths(this.ownedPaths);
      }
      this.commitCreated = false;
      this.createdCommit = null;
    }

    this.createdTags = [];
    this.createdTagTargets.clear();

    await this.changelogGenerator.rollback();
    await this.packageUpdater.rollback();
    if (removeLedger) await this.removeReleaseLedger();
    return true;
  }

  private async validateRollbackState(): Promise<void> {
    if (this.rollbackBlockedReason) {
      throw new Exit(
        `Cannot roll back release because ${this.rollbackBlockedReason}`,
        "Local release state and the recovery ledger were preserved",
      );
    }
    if (this.commitCreated && !this.createdCommit) {
      throw new Exit(
        "Cannot identify the release commit for rollback",
        "Local release state and the recovery ledger were preserved",
      );
    }
    if (this.commitCreated && this.createdCommit) {
      const [head, headReference] = await Promise.all([getHeadCommit(), getHeadReference()]);
      if (head !== this.createdCommit.oid || headReference !== this.createdCommit.ref) {
        throw new Exit(
          `Cannot roll back release commit because HEAD changed from ${this.createdCommit.oid}`,
          "Local release state and the recovery ledger were preserved",
        );
      }
    }

    if (this.commitCreated && this.ownedPaths) {
      const pathspecs = this.ownedPaths.map((path) => toLiteralPathspec(path));
      const status = await runInContext(
        () => Bun.$`git status --porcelain=v1 -z --untracked-files=all -- ${pathspecs}`.quiet(),
        "Failed to inspect release files before rollback",
      );
      if (status.stdout.length > 0) {
        throw new Exit(
          "Cannot roll back release because release-owned files changed after commit creation",
          "Local release state and the recovery ledger were preserved",
        );
      }
    }

    for (const tag of this.createdTags) {
      const expectedTarget = this.createdTagTargets.get(tag);
      const currentTarget = await resolveRef(`refs/tags/${tag}`);
      if (!expectedTarget || currentTarget !== expectedTarget) {
        throw new Exit(
          `Cannot roll back release because tag ${tag} changed after creation`,
          "Local release state and the recovery ledger were preserved",
        );
      }
    }
  }

  async removeReleaseLedger(): Promise<void> {
    if (!this.ledger) return;
    await this.ledger.remove();
    this.ledger = null;
  }

  private needsReleaseLedger(publishOnly: boolean): boolean {
    return this.options.npm || this.options.push || this.options.createRelease || (publishOnly && this.options.tags);
  }

  private async recoverReleaseCommit(data: ReleaseLedgerData): Promise<void> {
    if (data.releaseCommit || !this.ledger) return;

    const head = await getHeadCommit();
    if (!data.expectedReleaseTree && !data.options.publishOnly) {
      throw new Exit(
        `Release ${data.id} stopped before its expected release tree was recorded`,
        `No external operation was attempted; inspect the local changes and release ledger manually; delete ${this.ledger.activePath} to abort the release`,
      );
    }

    if (!data.options.publishOnly && head === data.baseCommit) {
      throw new Exit(
        `Release ${data.id} stopped before its release commit was created`,
        `No external operation was attempted; restore the release-owned files from ${data.baseCommit} and delete ${this.ledger.activePath} to abort the release`,
      );
    }

    await this.ensureExpectedReleaseTree(data, head);
    await validateReleaseCommitCandidate(this.ledger.data, head);
    await this.ledger.setReleaseCommit(head);
  }

  private async ensureLedgerPlan(packages: Package[], stones: Stone[]): Promise<void> {
    if (!this.ledger) return;

    const data = this.ledger.data;
    await this.reconcileReleaseTags(data);
    if (data.options.npm) {
      for (const pkg of packages) {
        if (!data.operations.npm[pkg.name] || data.operations.npmRegistries[pkg.name]) continue;
        await this.ledger.setNpmRegistry(pkg.name, await resolveNpmRegistry(pkg));
      }
    }

    if (!data.operations.push && (data.options.push || (data.options.publishOnly && data.options.tags))) {
      await this.configureLedgerPush(data);
    }

    if (data.options.createRelease) {
      await this.initCommitLinks();
      for (const pkg of packages) {
        await this.ledger.configureProviderRelease(pkg.name, getProviderRelease(stones, pkg, this.commitUrlFn));
      }
      await this.getProvider();
    }
  }

  private async reconcileReleaseTags(data: ReleaseLedgerData): Promise<void> {
    if (!this.ledger || !data.options.tags) return;
    if (!data.releaseCommit) throw new Error("Cannot reconcile release tags without a release commit");

    for (const tag of data.releaseTags) {
      const ref = `refs/tags/${tag}`;
      const result = await Bun.$`git rev-parse --verify ${ref}`.quiet().nothrow();
      if (result.exitCode !== 0) {
        await runInContext(
          () => Bun.$`git -c tag.gpgSign=false tag -- ${tag} ${data.releaseCommit}`.quiet(),
          `Failed to create tag ${tag}`,
        );
        continue;
      }

      const oid = result.stdout.toString().trim();
      if (oid !== data.releaseCommit) {
        throw new Exit(
          `Release tag ${tag} points to ${oid}, expected ${data.releaseCommit}`,
          "Do not move release tags before the release completes",
        );
      }
    }

    if (!data.tagsReady) await this.ledger.markTagsReady();
  }

  private async configureLedgerPush(data: ReleaseLedgerData): Promise<void> {
    if (!this.ledger || !data.releaseCommit) {
      throw new Error("Cannot configure release push without a recorded release commit");
    }

    const releaseCommit = data.releaseCommit;
    const tagRefs = data.releaseTags.map((tag) => ({
      destination: `refs/tags/${tag}`,
      oid: releaseCommit,
      source: `refs/tags/${tag}`,
    }));

    if (data.options.publishOnly) {
      const remote = await resolvePushRemote(await getCurrentBranchName());
      const destination = await resolveRemoteDestination(await getSinglePushUrl(remote), () =>
        this.getRepositoryRoot(),
      );
      this.validateProviderDestination(destination);
      await validatePushSources(tagRefs);
      await this.ledger.configurePush(remote, destination, tagRefs);
      return;
    }

    const { branch, remote } = await resolvePushTarget();
    const destination = await resolveRemoteDestination(await getSinglePushUrl(remote), () => this.getRepositoryRoot());
    this.validateProviderDestination(destination);
    const branchRef = `refs/heads/${branch}`;
    const refs = [{ destination: branchRef, oid: data.releaseCommit, source: branchRef }, ...tagRefs];
    await validatePushSources(refs);
    await this.ledger.configurePush(remote, destination, refs);
  }

  private validateProviderDestination(destination: ReleaseLedgerRemoteDestination): void {
    if (this.options.createRelease && !getDestinationProvider(destination)) {
      throw new Exit(
        "Push destination is not a supported git provider repository",
        "Provider releases require GitHub, GitLab, or Bitbucket",
      );
    }
  }

  private async resumeExternalOperations(packages: Package[], stones: Stone[]): Promise<void> {
    const ledger = this.requireLedger("resume external operations");
    if (ledger.phase === "completed") {
      await this.completeRelease();
      return;
    }

    if (ledger.data.operations.push) await this.pushConfiguredRefs();
    if (this.options.npm) await this.publishToNpm(packages);
    if (this.options.createRelease) await this.createGitRelease(stones, packages);
    await this.completeRelease();
  }

  private async pushConfiguredRefs(): Promise<void> {
    const ledger = this.requireLedger("push release refs");
    const operation = ledger.data.operations.push;
    if (!operation) throw new Error("Release push is not configured");
    if (operation.state === "completed") return;
    await getValidatedPushUrl(operation, () => this.getRepositoryRoot());

    if (operation.state === "started") {
      await reconcileReleasePush(ledger, operation, () => this.getRepositoryRoot());
      return;
    }

    await ledger.setPhase("external");
    await ledger.markPush("started");
    this.crossIrreversibleBoundary("remote push");
    await performAtomicPush(operation, () => this.getRepositoryRoot());
    await ledger.markPush("completed");
  }

  private async publishPreparedPackage(prepared: PreparedNpmPackage): Promise<void> {
    const ledger = this.requireLedger(`publish ${prepared.pkg.name}`);
    const operation = ledger.data.operations.npm[prepared.pkg.name];
    if (!operation) throw new Error(`Npm operation is not configured for ${prepared.pkg.name}`);
    if (operation.state === "completed") return;

    if (operation.state === "started") {
      await reconcileNpmPublication(ledger, prepared.pkg);
      return;
    }

    await ledger.setPhase("external");
    await ledger.markNpm(prepared.pkg.name, "started");
    this.crossIrreversibleBoundary("npm publication");
    await this.publishPackage(prepared);
    await ledger.markNpm(prepared.pkg.name, "completed");
  }

  private requireLedger(operation: string): ReleaseLedger {
    if (!this.ledger) throw new Error(`Cannot ${operation} without an active release ledger`);
    return this.ledger;
  }

  private async createProviderRelease(
    provider: GitProvider,
    packageName: string,
    release: { notes: string; tag: string; title: string },
  ): Promise<void> {
    const ledger = this.requireLedger(`create the provider release for ${release.tag}`);
    const operation = ledger.data.operations.providerReleases[packageName];
    if (!operation) throw new Error(`Provider release is not configured for ${packageName}`);
    if (operation.state === "completed") return;

    if (operation.state === "started") {
      await this.reconcileStartedProviderRelease(provider, packageName, operation);
      return;
    }

    await ledger.setPhase("external");
    await ledger.markProviderRelease(packageName, "started");
    this.crossIrreversibleBoundary(`git provider release creation for ${release.tag}`);
    await runInContext(() => provider.createRelease(release), `Failed to create release for ${release.tag}`);
    await ledger.markProviderRelease(packageName, "completed");
  }

  private async reconcileStartedProviderRelease(
    provider: GitProvider,
    packageName: string,
    operation: ReleaseLedgerProviderReleaseOperation,
  ): Promise<void> {
    const existing = await runInContext(
      () => provider.getRelease(operation.tag),
      `Failed to inspect release for ${operation.tag}`,
    );
    if (!existing) {
      throw new Exit(
        `Cannot safely resume provider release ${operation.tag}`,
        "The provider does not confirm the previous creation; inspect the release manually",
      );
    }
    if (
      existing.draft ||
      existing.tag !== operation.tag ||
      existing.title !== operation.title ||
      existing.notes !== operation.notes
    ) {
      throw new Exit(
        `Cannot safely resume provider release ${operation.tag}: existing release does not match`,
        "Do not overwrite the existing release; compare its title and notes with the release ledger",
      );
    }

    await this.ledger?.markProviderRelease(packageName, "completed");
  }

  private async getOwnedPaths(packages: Package[], stones: Stone[]): Promise<string[]> {
    const repositoryRoot = await this.getRepositoryRoot();
    const changelogFiles = this.options.changelog ? getChangelogFiles(this.config.get("changelog"), packages) : [];
    const candidates = [
      ...packages.map((pkg) => pkg.file),
      ...changelogFiles,
      join(DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE),
      ...this.stoneManager.getFilePaths(stones),
    ];
    const normalized = [...new Set(candidates.map((path) => normalizeOwnedPath(repositoryRoot, path)))].sort();

    if (
      this.ownedPaths &&
      (this.ownedPaths.length !== normalized.length ||
        this.ownedPaths.some((path, index) => path !== normalized[index]))
    ) {
      throw new Error("Release paths changed");
    }

    this.ownedPaths = normalized;
    return normalized;
  }

  private async getRepositoryRoot(): Promise<string> {
    if (this.repositoryRoot) return this.repositoryRoot;

    const result = await runInContext(
      () => Bun.$`git rev-parse --show-toplevel`.quiet(),
      "Failed to resolve git repository root",
    );
    const root = result.stdout.toString().trim();
    if (!root) throw new Error("Git repository root is empty");

    this.repositoryRoot = resolve(root);
    return this.repositoryRoot;
  }

  private async validatePublishCommitBinding(commit: string): Promise<void> {
    const data = this.requireLedger("bind npm artifacts to a release commit").data;
    if (!data.releaseCommit || !data.expectedReleaseTree || commit !== data.releaseCommit) {
      throw new Exit(
        `Publish source does not match the recorded release commit for ${data.id}`,
        data.releaseCommit
          ? `Check out ${data.releaseCommit} before publishing`
          : "Resume the release before publishing",
      );
    }
    await validateReleaseCommitCandidate(data, commit);
  }

  private async ensureExpectedReleaseTree(data: ReleaseLedgerData, candidate: string): Promise<void> {
    if (data.expectedReleaseTree) return;
    if (!this.ledger || !data.options.publishOnly || candidate !== data.baseCommit) {
      throw new Exit(
        `Release ${data.id} has no recorded expected release tree`,
        "No external operation was attempted; inspect the release state manually",
      );
    }

    await this.ledger.setExpectedReleaseTree(await getCommitTree(data.baseCommit));
  }

  private getPackageSetKey(packages: Package[]): string {
    return packages.map((pkg) => `${pkg.name}\u0000${pkg.file}`).join("\u0000");
  }

  private async publishPackage(prepared: PreparedNpmPackage): Promise<void> {
    const ledger = this.requireLedger(`publish ${prepared.pkg.name}`);
    const tag = ledger.data.options.npmTag;
    const access = resolveNpmAccess(await readPackedManifest(prepared.artifactPath));
    const registry = ledger.data.operations.npmRegistries[prepared.pkg.name];
    if (!registry) throw new Error(`Npm registry is not configured for ${prepared.pkg.name}`);
    const scopeRegistryArgs = getScopeRegistryArgs(prepared.pkg.name, registry);
    await runInContext(
      () =>
        Bun.$`npm publish ${prepared.artifactPath} --tag ${tag} --access ${access} --ignore-scripts --registry ${registry} ${scopeRegistryArgs}`
          .cwd(dirname(prepared.pkg.file))
          .quiet(),
      `Failed to publish ${prepared.pkg.name}`,
    );
  }

  private async prepareNpmArtifact(pkg: Package, artifactPath: string): Promise<void> {
    const packageDirectory = dirname(pkg.file);
    let stagingDirectory: string | null = null;
    try {
      const sourceCommit = await getHeadCommit();
      await this.validatePublishCommitBinding(sourceCommit);
      await validatePublishSources(await this.getRepositoryRoot());
      await this.validateIgnoredBuildInputs();
      const build = this.getBuildConfig();
      await validateExistingPackInputs(pkg, packageDirectory, await this.getRepositoryRoot(), build.matcher);
      if (build.command.length > 0) {
        await runBuildCommand(build.command, packageDirectory, `Failed to build ${pkg.name}`);
      }
      const builtSourceCommit = await getHeadCommit();
      await this.validatePublishCommitBinding(builtSourceCommit);
      const builtSourceStatus = await getPublishSourceStatus(await this.getRepositoryRoot());
      if (builtSourceCommit !== sourceCommit || builtSourceStatus.length > 0) {
        throw new Exit(
          `Package build changed repository source files for ${pkg.name}`,
          "This package was not packed and nothing was published; restore the build changes before retrying",
        );
      }

      const builtText = await readFile(pkg.file, "utf-8");
      const { catalogs, workspaceVersions } = await this.getPublishContext();
      const publishText = renderPublishManifest(builtText, catalogs, workspaceVersions);
      resolveNpmAccess(publishText);
      const publishManifest = JSON.parse(publishText) as { name?: unknown; version?: unknown };
      const expectedVersion = pkg.newVersion ?? pkg.version;
      if (publishManifest.name !== pkg.name || publishManifest.version !== expectedVersion) {
        throw new Error(
          `Packed manifest identity mismatch for ${pkg.name}: expected ${pkg.name}@${expectedVersion}, found ${String(publishManifest.name)}@${String(publishManifest.version)}`,
        );
      }

      stagingDirectory = await stagePackageForPack(pkg, packageDirectory, publishText);
      const packedIdentity = await packNpmArtifact(stagingDirectory, artifactPath);
      if (packedIdentity.name !== pkg.name || packedIdentity.version !== expectedVersion) {
        throw new Exit(
          `Packed artifact identity mismatch for ${pkg.name}: found ${packedIdentity.name}@${packedIdentity.version}`,
          "This package was not recorded and nothing was published",
        );
      }
      if (!sameJsonDocument(publishText, await readPackedManifest(artifactPath))) {
        throw new Exit(
          `Packed manifest does not match the prepared manifest for ${pkg.name}`,
          "This package was not recorded and nothing was published",
        );
      }
      const packedSourceCommit = await getHeadCommit();
      await this.validatePublishCommitBinding(packedSourceCommit);
      const packedSourceStatus = await getPublishSourceStatus(await this.getRepositoryRoot());
      if (packedSourceCommit !== sourceCommit || packedSourceStatus.length > 0) {
        throw new Exit(
          `Package packing changed repository source files for ${pkg.name}`,
          "This package was not recorded and nothing was published; restore the changes before retrying",
        );
      }
    } finally {
      if (stagingDirectory) await rm(stagingDirectory, { force: true, recursive: true });
    }
  }

  private async validateIgnoredBuildInputs(): Promise<void> {
    if (this.ignoredBuildInputsValidated) return;
    await validateRepositoryIgnoredInputs(await this.getRepositoryRoot(), "", this.getBuildConfig().matcher);
    this.ignoredBuildInputsValidated = true;
  }

  getLedgerSnapshot(): ReleaseLedgerData | null {
    return this.ledger?.data ?? null;
  }

  private getBuildConfig(): ResolvedBuildConfig {
    this.buildConfig ??= resolveBuildConfig(this.config.get("release")?.build);
    return this.buildConfig;
  }

  private async prepareBuildOutputs(): Promise<void> {
    if (this.buildOutputsPrepared) return;

    const build = this.getBuildConfig();
    const repositoryRoot = await this.getRepositoryRoot();
    const sourceCommit = await getHeadCommit();

    await this.validatePublishCommitBinding(sourceCommit);
    await validatePublishSources(repositoryRoot);
    await assertBuildOutputsUntracked(repositoryRoot, build.matcher);
    await cleanBuildOutputs(repositoryRoot, "", build.matcher);

    for (const [index, argv] of build.root.entries()) {
      await runBuildCommand(argv, repositoryRoot, `Failed to run release root build command ${index}`);
    }

    if (build.root.length > 0) {
      const builtCommit = await getHeadCommit();
      await this.validatePublishCommitBinding(builtCommit);
      if (builtCommit !== sourceCommit || (await getPublishSourceStatus(repositoryRoot)).length > 0) {
        throw new Exit(
          "Root build changed repository source files",
          "No package was packed and nothing was published; restore the build changes before retrying",
        );
      }
    }

    await this.validateIgnoredBuildInputs();
    this.buildOutputsPrepared = true;
  }

  private async getPublishContext(): Promise<{ catalogs: CatalogMap; workspaceVersions: WorkspaceVersionMap }> {
    if (!this.publishContext) {
      const rootManifest = (await Bun.file("package.json").json()) as RootManifest;
      const { packages } = await WorkspaceScanner.scan({ single: this.config.get("single") });
      this.publishContext = {
        catalogs: extractCatalogs(rootManifest),
        workspaceVersions: workspaceVersionsFromPackages(packages.values()),
      };
    }
    return this.publishContext;
  }

  private crossIrreversibleBoundary(operation: string): void {
    this.irreversibleOperation ??= operation;
  }
}
