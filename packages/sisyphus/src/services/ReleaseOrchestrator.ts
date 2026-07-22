import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { type ConfigManager, Exit } from "@r5n/cli-core";
import { DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE, DEFAULT_NPM_TAG } from "../constants";
import { type CommitInfo, Package, Stone } from "../domain";
import { createGitProvider, type GitProvider, parseRemoteUrl, type RemoteInfo } from "../providers";
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
  ReleaseLedger,
  type ReleaseLedgerData,
  type ReleaseLedgerProviderReleaseOperation,
  type ReleaseLedgerPushOperation,
  type ReleaseLedgerRemoteDestination,
} from "./ReleaseLedger";
import { validateReleaseCheckout } from "./ReleaseSource";
import { StoneManager } from "./StoneManager";
import { WorkspaceScanner } from "./WorkspaceScanner";

export type ReleaseOptions = {
  changelog: boolean;
  createRelease: boolean;
  dryRun: boolean;
  npm: boolean;
  push: boolean;
  tags: boolean;
};

type PreparedNpmPackage = { artifactPath: string; pkg: Package };
type PreparedNpmPublish = { key: string; packages: PreparedNpmPackage[]; tempDir: string | null };
type PackedPackageIdentity = { name: string; version: string };
type PushTarget = { branch: string; remote: string };
type ResumeResult = { packages: Package[] };

const NPM_TAG_PATTERN = /^[A-Za-z][0-9A-Za-z._-]*$/;
const SEMVER_LIKE_NPM_TAG_PATTERN =
  /^(?:[vV]?\d+(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|[xX])$/;
const TAR_BLOCK_SIZE = 512;
const TAR_NAME_LENGTH = 100;
const TAR_SIZE_OFFSET = 124;
const TAR_SIZE_LENGTH = 12;
const TAR_PREFIX_OFFSET = 345;
const TAR_PREFIX_LENGTH = 155;
const PACKED_MANIFEST_PATH = "package/package.json";

export function isValidNpmTag(tag: string): boolean {
  return NPM_TAG_PATTERN.test(tag) && !SEMVER_LIKE_NPM_TAG_PATTERN.test(tag);
}

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
      return { packages };
    }

    try {
      await orchestrator.recoverReleaseCommit(data);
      await orchestrator.validateReleaseCommit(ledger.data);
      await orchestrator.ensureLedgerPlan(packages, stones);
      if (data.options.npm) {
        const needsArtifact = packages.some(
          (pkg) => ledger.data.operations.npm[pkg.name] && !ledger.data.artifacts[pkg.name],
        );
        if (needsArtifact) await orchestrator.validatePublishSources();
        await orchestrator.prepareNpmPublish(packages);
      }
      if (ledger.phase === "planned") await ledger.setPhase("local-ready");
      await orchestrator.resumeExternalOperations(packages, stones);
      return { packages };
    } catch (error) {
      if (orchestrator.hasCrossedIrreversibleBoundary()) {
        throw orchestrator.createIncompleteReleaseError(error);
      }
      throw error;
    }
  }

  async initializeExternalRelease(packages: Package[], stones: Stone[], publishOnly: boolean): Promise<void> {
    if (this.options.dryRun || !this.needsReleaseLedger(publishOnly)) return;

    this.ledger = await ReleaseLedger.create({
      options: { ...this.options, npmTag: this.options.npm ? this.getNpmTag() : DEFAULT_NPM_TAG, publishOnly },
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
    if (this.options.npm) await this.validatePublishSources();
    const releaseCommit = await this.getHeadCommit();
    await this.ensureExpectedReleaseTree(this.ledger.data, releaseCommit);
    await this.validateReleaseCommitCandidate(this.ledger.data, releaseCommit);
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
      const info = this.getDestinationProvider(destination);
      this.provider = await createGitProvider(info);
    }
    return this.provider;
  }

  private async initCommitLinks(): Promise<void> {
    if (this.commitUrlFn !== null) return;
    const destination = this.ledger?.data.operations.push?.destination;
    const info = this.getDestinationProvider(destination);
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
    await this.validateOwnedPaths(ownedPaths);
    const pathspecs = ownedPaths.map((path) => this.toLiteralPathspec(path));
    const result = await this.run(
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
    const pathspecs = ownedPaths.map((path) => this.toLiteralPathspec(path));
    const message = this.formatCommitMessage(stone, packages);
    const authorArg = this.getCommitAuthorArg();
    const baseCommit = this.ledger?.data.baseCommit ?? (await this.getHeadCommit());
    const headReference = await this.getHeadReference();
    let expectedReleaseTree: string | undefined;
    let stagedState: string | undefined;

    try {
      await this.run(() => Bun.$`git add -A -- ${pathspecs}`.quiet(), "Failed to stage release files");
      if ((await this.getHeadCommit()) !== baseCommit) {
        throw new Exit(
          "Release base commit changed before commit creation",
          "Restart the release from the intended branch",
        );
      }
      expectedReleaseTree = await this.writeExpectedReleaseTree(baseCommit, ownedPaths);
      await this.ledger?.setExpectedReleaseTree(expectedReleaseTree);
      stagedState = await this.getOwnedMutationFingerprint(ownedPaths);
      await this.run(
        () => Bun.$`git commit --only ${authorArg} -m ${message} -- ${pathspecs}`.env(this.getCommitterEnv()).quiet(),
        "Failed to create commit",
      );
      this.commitCreated = true;
    } catch (error) {
      if (stagedState) {
        let currentState: string;
        try {
          currentState = await this.getOwnedMutationFingerprint(ownedPaths);
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
        await this.unstageOwnedPaths(ownedPaths);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Commit and index cleanup failed");
      }
      throw error;
    }

    const releaseCommit = await this.getHeadCommit();
    this.createdCommit = { baseCommit, oid: releaseCommit, ref: headReference };
    if (!expectedReleaseTree) throw new Error("Expected release tree was not recorded before commit");
    if (this.ledger) {
      await this.validateReleaseCommitCandidate(this.ledger.data, releaseCommit);
      return;
    }

    await this.validateCommitParent(releaseCommit, baseCommit);
    await this.validateCommitTree(releaseCommit, expectedReleaseTree);
  }

  private getCommitAuthorArg(): string[] {
    const { author, email } = this.config.get("commit");
    const normalizedAuthor = author.trim();
    const normalizedEmail = email?.trim() ?? "";

    if (!normalizedAuthor && !normalizedEmail) return [];
    if (!normalizedAuthor || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(normalizedEmail)) {
      throw new Exit("Invalid release commit author", "Set valid commit.author and commit.email");
    }

    return ["--author", `${normalizedAuthor} <${normalizedEmail}>`];
  }

  private getCommitterEnv(): Record<string, string> {
    const { author, email } = this.config.get("commit");
    const env = { ...process.env } as Record<string, string>;
    if (!author) return env;

    env.GIT_COMMITTER_NAME = author;
    if (email) env.GIT_COMMITTER_EMAIL = email;
    return env;
  }

  private getChangelogFiles(packages: Package[]): string[] {
    const filename = this.config.get("changelog").filename;
    const files = packages.map((pkg) => join(dirname(pkg.file), filename));

    if (this.config.get("changelog").root) {
      files.push(filename);
    }

    return files;
  }

  async createGitTags(packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;

    for (const pkg of packages) {
      const version = pkg.newVersion ?? pkg.version;
      const tagName = `${pkg.name}@${version}`;
      const target = await this.getHeadCommit();
      await this.run(() => Bun.$`git tag -- ${tagName}`.quiet(), `Failed to create tag ${tagName}`);
      this.createdTags.push(tagName);
      this.createdTagTargets.set(tagName, target);
    }
  }

  async prepareNpmPublish(packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;

    const key = this.getPackageSetKey(packages);
    if (this.preparedNpmPublish?.key === key) return;

    await this.cleanupPreparedNpmPublish();
    const publishablePackages = await this.getPublishablePackages(packages);
    if (publishablePackages.length === 0) {
      this.preparedNpmPublish = { key, packages: [], tempDir: null };
      return;
    }

    if (this.ledger) {
      const tempDir = await mkdtemp(join(tmpdir(), "sisyphus-publish-"));
      const preparedPackages: PreparedNpmPackage[] = [];

      try {
        for (const [index, pkg] of publishablePackages.entries()) {
          const existingArtifact = this.ledger.data.artifacts[pkg.name];
          if (existingArtifact) {
            preparedPackages.push({ artifactPath: this.ledger.resolveArtifactPath(pkg.name), pkg });
            continue;
          }

          const artifactPath = join(tempDir, `${String(index).padStart(4, "0")}.tgz`);
          await this.run(() => this.prepareNpmArtifact(pkg, artifactPath), `Failed to prepare ${pkg.name}`);
          await this.ledger.setArtifact(pkg.name, artifactPath);
          preparedPackages.push({ artifactPath: this.ledger.resolveArtifactPath(pkg.name), pkg });
        }
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
      this.preparedNpmPublish = { key, packages: preparedPackages, tempDir: null };
      return;
    }

    const tempDir = await mkdtemp(join(tmpdir(), "sisyphus-publish-"));
    const preparedPackages: PreparedNpmPackage[] = [];

    try {
      for (const [index, pkg] of publishablePackages.entries()) {
        const artifactPath = join(tempDir, `${String(index).padStart(4, "0")}.tgz`);
        await this.run(() => this.prepareNpmArtifact(pkg, artifactPath), `Failed to prepare ${pkg.name}`);
        preparedPackages.push({ artifactPath, pkg });
      }
    } catch (error) {
      try {
        await rm(tempDir, { force: true, recursive: true });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "NPM preparation cleanup failed");
      }
      throw error;
    }

    this.preparedNpmPublish = { key, packages: preparedPackages, tempDir };
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
      await this.cleanupPreparedNpmPublish();
    }
  }

  async pushToRemote(): Promise<void> {
    if (this.options.dryRun) return;

    if (this.ledger) {
      await this.pushConfiguredRefs();
      return;
    }

    const { branch, remote } = await this.resolvePushTarget();
    const branchRef = `refs/heads/${branch}`;
    const refspecs = [
      `${branchRef}:${branchRef}`,
      ...this.createdTags.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`),
    ];

    this.crossIrreversibleBoundary("remote push");
    await this.run(
      () => Bun.$`git push --atomic ${remote} ${refspecs}`.quiet(),
      "Failed to atomically push release refs",
    );
  }

  async pushTags(): Promise<void> {
    if (this.options.dryRun) return;
    if (this.createdTags.length === 0) return;

    if (this.ledger) {
      await this.pushConfiguredRefs();
      return;
    }

    const branchResult = await Bun.$`git symbolic-ref --quiet --short HEAD`.quiet().nothrow();
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.toString().trim() || undefined : undefined;
    const remote = await this.resolvePushRemote(branch);
    const refspecs = this.createdTags.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`);

    this.crossIrreversibleBoundary("remote tag push");
    await this.run(
      () => Bun.$`git push --atomic ${remote} ${refspecs}`.quiet(),
      "Failed to atomically push release tags",
    );
  }

  async createGitRelease(stones: Stone[], packages: Package[]): Promise<void> {
    if (this.options.dryRun) return;
    if (packages.length === 0) return;

    await this.initCommitLinks();
    const provider = await this.getProvider();
    const pushOperation = this.ledger?.data.operations.push;
    if (pushOperation) await this.verifyRemoteRefs(pushOperation);

    for (const pkg of packages) {
      const release = this.getProviderRelease(stones, pkg);
      await this.createProviderRelease(provider, pkg.name, release);
    }
  }

  private getProviderRelease(stones: Stone[], pkg: Package): { notes: string; tag: string; title: string } {
    const version = pkg.newVersion ?? pkg.version;
    return {
      notes: this.formatReleaseNotes(this.filterStonesForPackage(stones, pkg.name), pkg),
      tag: `${pkg.name}@${version}`,
      title: `${pkg.name} v${version}`,
    };
  }

  private filterStonesForPackage(stones: Stone[], packageName: string): Stone[] {
    return stones.filter((stone) => stone.affectsPackage(packageName));
  }

  private formatReleaseNotes(stones: Stone[], pkg: Package): string {
    const lines: string[] = [];
    const version = pkg.newVersion ?? pkg.version;

    lines.push(`\`${pkg.name}\` ${pkg.version} → ${version}`);

    if (stones.length === 0) return lines.join("\n");

    lines.push("");
    lines.push("<details>");
    lines.push(`<summary>Stones (${stones.length})</summary>`);
    lines.push("");

    for (const stone of stones) {
      lines.push(`### ${stone.message}`);
      lines.push("");
      if (stone.description) {
        lines.push(stone.description);
        lines.push("");
      }
      const commits = this.filterCommitsForPackage(stone.commits, pkg.name);
      if (commits.length > 0) {
        lines.push("<details>");
        lines.push(`<summary>Commits (${commits.length})</summary>`);
        lines.push("");
        for (const commit of commits) {
          lines.push(this.formatCommitLine(commit));
        }
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    }

    lines.push("</details>");

    return lines.join("\n");
  }

  private filterCommitsForPackage(commits: readonly CommitInfo[] | undefined, packageName: string): CommitInfo[] {
    if (!commits) return [];
    return commits.filter((commit) => commit.packages.includes(packageName));
  }

  private formatCommitLine(commit: CommitInfo): string {
    const hashDisplay = this.commitUrlFn
      ? `[\`${commit.hash}\`](${this.commitUrlFn(commit.hash)})`
      : `\`${commit.hash}\``;
    return `- ${hashDisplay} ${commit.subject}`;
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

    await this.cleanupPreparedNpmPublish();
    await this.updateRollbackRefs();

    if (this.commitCreated) {
      if (this.ownedPaths) {
        await this.unstageOwnedPaths(this.ownedPaths);
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
      const [head, headReference] = await Promise.all([this.getHeadCommit(), this.getHeadReference()]);
      if (head !== this.createdCommit.oid || headReference !== this.createdCommit.ref) {
        throw new Exit(
          `Cannot roll back release commit because HEAD changed from ${this.createdCommit.oid}`,
          "Local release state and the recovery ledger were preserved",
        );
      }
    }

    if (this.commitCreated && this.ownedPaths) {
      const pathspecs = this.ownedPaths.map((path) => this.toLiteralPathspec(path));
      const status = await this.run(
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
      const currentTarget = await this.resolveRef(`refs/tags/${tag}`);
      if (!expectedTarget || currentTarget !== expectedTarget) {
        throw new Exit(
          `Cannot roll back release because tag ${tag} changed after creation`,
          "Local release state and the recovery ledger were preserved",
        );
      }
    }
  }

  private async updateRollbackRefs(): Promise<void> {
    const commands: string[] = [];
    if (this.createdCommit) {
      commands.push(
        `update ${this.createdCommit.ref ?? "HEAD"} ${this.createdCommit.baseCommit} ${this.createdCommit.oid}`,
      );
    }
    for (const tag of this.createdTags) {
      const target = this.createdTagTargets.get(tag);
      if (!target) throw new Error(`Missing rollback target for release tag ${tag}`);
      commands.push(`delete refs/tags/${tag} ${target}`);
    }
    if (commands.length === 0) return;

    const repositoryRoot = await this.getRepositoryRoot();
    const input = Buffer.from(["start", ...commands, "prepare", "commit", ""].join("\n"));
    await this.run(async () => {
      const subprocess = Bun.spawn(["git", "update-ref", "--stdin"], {
        cwd: repositoryRoot,
        stderr: "pipe",
        stdin: input,
        stdout: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stderr).text()]);
      if (exitCode !== 0) throw new Error(stderr.trim() || `git update-ref exited with code ${exitCode}`);
    }, "Failed to atomically restore release refs");
  }

  async removeReleaseLedger(): Promise<void> {
    if (!this.ledger) return;
    await this.ledger.remove();
    this.ledger = null;
  }

  private needsReleaseLedger(publishOnly: boolean): boolean {
    return this.options.npm || this.options.push || this.options.createRelease || (publishOnly && this.options.tags);
  }

  private async validateReleaseCommit(data: ReleaseLedgerData): Promise<void> {
    if (!data.releaseCommit) {
      throw new Exit(
        `Release ${data.id} has no recorded source commit`,
        "No external operation will be retried; inspect the local release state manually",
      );
    }

    const head = await this.getHeadCommit();
    if (head !== data.releaseCommit) {
      throw new Exit(
        `Release ${data.id} was prepared from ${data.releaseCommit}, but HEAD is ${head}`,
        `Check out ${data.releaseCommit} before resuming`,
      );
    }
    if (!data.expectedReleaseTree) {
      throw new Exit(
        `Release ${data.id} has no recorded expected release tree`,
        "No external operation will be retried; inspect the release ledger manually",
      );
    }
    await this.validateReleaseCommitCandidate(data, head);
  }

  private async recoverReleaseCommit(data: ReleaseLedgerData): Promise<void> {
    if (data.releaseCommit || !this.ledger) return;

    const head = await this.getHeadCommit();
    if (!data.expectedReleaseTree && !data.options.publishOnly) {
      throw new Exit(
        `Release ${data.id} stopped before its expected release tree was recorded`,
        "No external operation was attempted; inspect the local changes and release ledger manually",
      );
    }

    await this.ensureExpectedReleaseTree(data, head);
    await this.validateReleaseCommitCandidate(this.ledger.data, head);
    await this.ledger.setReleaseCommit(head);
  }

  private async ensureLedgerPlan(packages: Package[], stones: Stone[]): Promise<void> {
    if (!this.ledger) return;

    const data = this.ledger.data;
    await this.reconcileReleaseTags(data);
    if (data.options.npm) {
      for (const pkg of packages) {
        if (!data.operations.npm[pkg.name] || data.operations.npmRegistries[pkg.name]) continue;
        await this.ledger.setNpmRegistry(pkg.name, await this.resolveNpmRegistry(pkg));
      }
    }

    if (!data.operations.push && (data.options.push || (data.options.publishOnly && data.options.tags))) {
      await this.configureLedgerPush(data);
    }

    if (data.options.createRelease) {
      await this.initCommitLinks();
      for (const pkg of packages) {
        await this.ledger.configureProviderRelease(pkg.name, this.getProviderRelease(stones, pkg));
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
        await this.run(() => Bun.$`git tag -- ${tag} ${data.releaseCommit}`.quiet(), `Failed to create tag ${tag}`);
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
      const branchResult = await Bun.$`git symbolic-ref --quiet --short HEAD`.quiet().nothrow();
      const branch = branchResult.exitCode === 0 ? branchResult.stdout.toString().trim() || undefined : undefined;
      const remote = await this.resolvePushRemote(branch);
      const destination = await this.resolveRemoteDestination(remote);
      this.validateProviderDestination(destination);
      await this.validatePushSources(tagRefs);
      await this.ledger.configurePush(remote, destination, tagRefs);
      return;
    }

    const { branch, remote } = await this.resolvePushTarget();
    const destination = await this.resolveRemoteDestination(remote);
    this.validateProviderDestination(destination);
    const branchRef = `refs/heads/${branch}`;
    const refs = [{ destination: branchRef, oid: data.releaseCommit, source: branchRef }, ...tagRefs];
    await this.validatePushSources(refs);
    await this.ledger.configurePush(remote, destination, refs);
  }

  private validateProviderDestination(destination: ReleaseLedgerRemoteDestination): void {
    if (this.options.createRelease && !this.getDestinationProvider(destination)) {
      throw new Exit(
        "Push destination is not a supported git provider repository",
        "Provider releases require GitHub, GitLab, or Bitbucket",
      );
    }
  }

  private getDestinationProvider(destination: ReleaseLedgerRemoteDestination | undefined): RemoteInfo | undefined {
    if (!destination?.provider || !destination.owner || !destination.repo) return undefined;
    return { owner: destination.owner, provider: destination.provider, repo: destination.repo };
  }

  private async resolveRemoteDestination(remote: string): Promise<ReleaseLedgerRemoteDestination> {
    const rawUrl = await this.getSinglePushUrl(remote);
    const info = parseRemoteUrl(rawUrl);
    return {
      canonicalUrl: await this.canonicalizeRemoteUrl(rawUrl),
      ...(info ? { owner: info.owner, provider: info.provider, repo: info.repo } : {}),
    };
  }

  private async canonicalizeRemoteUrl(rawUrl: string): Promise<string> {
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      parsedUrl = null;
    }

    if (parsedUrl) {
      if (parsedUrl.username || parsedUrl.password) {
        throw new Exit("Push URL contains embedded credentials", "Configure git authentication outside the remote URL");
      }
      parsedUrl.search = "";
      parsedUrl.hash = "";
      return parsedUrl.href;
    }

    const scp = rawUrl.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
    if (scp?.[1] && scp[2]) return `ssh://${scp[1].toLowerCase()}/${scp[2].replace(/^\/+/, "")}`;
    return pathToFileURL(resolve(await this.getRepositoryRoot(), rawUrl)).href;
  }

  private async getSinglePushUrl(remote: string): Promise<string> {
    const result = await this.run(
      () => Bun.$`git remote get-url --push --all ${remote}`.quiet(),
      `Failed to resolve push URL for ${remote}`,
    );
    const urls = result.stdout.toString().trim().split("\n").filter(Boolean);
    if (urls.length !== 1) {
      throw new Exit(
        `Push remote ${remote} must have exactly one push URL, found ${urls.length}`,
        "Remove additional push URLs before starting or resuming a release",
      );
    }
    const [url] = urls;
    if (!url) throw new Exit(`Push remote ${remote} has no URL`);
    return url;
  }

  private async getValidatedPushUrl(operation: ReleaseLedgerPushOperation): Promise<string> {
    const pushUrl = await this.getSinglePushUrl(operation.remote);
    const current = { canonicalUrl: await this.canonicalizeRemoteUrl(pushUrl), ...(parseRemoteUrl(pushUrl) ?? {}) };
    if (JSON.stringify(current) !== JSON.stringify(operation.destination)) {
      throw new Exit(
        `Push remote ${operation.remote} no longer matches the recorded release destination`,
        "Restore the original remote before resuming the release",
      );
    }
    return pushUrl;
  }

  private async validatePushSources(refs: Array<{ source: string; destination: string; oid: string }>): Promise<void> {
    for (const ref of refs) {
      const result = await this.run(
        () => Bun.$`git rev-parse ${ref.source}`.quiet(),
        `Failed to resolve ${ref.source}`,
      );
      const oid = result.stdout.toString().trim();
      if (oid !== ref.oid) {
        throw new Exit(
          `Release ref ${ref.source} points to ${oid}, expected ${ref.oid}`,
          "Do not move release refs before the release completes",
        );
      }
    }
  }

  private async resumeExternalOperations(packages: Package[], stones: Stone[]): Promise<void> {
    if (!this.ledger) throw new Error("Cannot resume without an active release ledger");

    if (this.ledger.phase === "completed") {
      await this.completeRelease();
      return;
    }

    if (this.ledger.data.operations.push) await this.pushConfiguredRefs();
    if (this.options.npm) await this.publishToNpm(packages);
    if (this.options.createRelease) await this.createGitRelease(stones, packages);
    await this.completeRelease();
  }

  private async pushConfiguredRefs(): Promise<void> {
    if (!this.ledger) throw new Error("Cannot push without an active release ledger");
    const operation = this.ledger.data.operations.push;
    if (!operation) throw new Error("Release push is not configured");
    if (operation.state === "completed") return;
    const pushUrl = await this.getValidatedPushUrl(operation);

    if (operation.state === "started") {
      await this.reconcileStartedPush(operation);
      return;
    }

    await this.ledger.setPhase("external");
    await this.ledger.markPush("started");
    this.crossIrreversibleBoundary("remote push");
    const refspecs = operation.refs.map((ref) => `${ref.oid}:${ref.destination}`);
    await this.run(
      () => Bun.$`git push --atomic ${pushUrl} ${refspecs}`.quiet(),
      "Failed to atomically push release refs",
    );
    await this.ledger.markPush("completed");
  }

  private async reconcileStartedPush(operation: ReleaseLedgerPushOperation): Promise<void> {
    await this.verifyRemoteRefs(operation);
    await this.ledger?.markPush("completed");
  }

  private async verifyRemoteRefs(operation: ReleaseLedgerPushOperation): Promise<void> {
    const pushUrl = await this.getValidatedPushUrl(operation);
    const destinations = operation.refs.map((ref) => ref.destination);
    const result = await this.run(
      () => Bun.$`git ls-remote --refs ${pushUrl} ${destinations}`.quiet(),
      "Failed to inspect remote release refs",
    );
    const remoteRefs = new Map(
      result.stdout
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [oid = "", ref = ""] = line.split("\t");
          return [ref, oid] as const;
        }),
    );
    const mismatch = operation.refs.find((ref) => remoteRefs.get(ref.destination) !== ref.oid);
    if (mismatch) {
      throw new Exit(
        `Cannot safely resume remote push: ${mismatch.destination} is not at ${mismatch.oid}`,
        "The previous push may not have completed; inspect the remote refs manually",
      );
    }
  }

  private async publishPreparedPackage(prepared: PreparedNpmPackage): Promise<void> {
    if (!this.ledger) {
      this.crossIrreversibleBoundary("npm publication");
      await this.publishPackage(prepared);
      return;
    }

    const operation = this.ledger.data.operations.npm[prepared.pkg.name];
    if (!operation) throw new Error(`Npm operation is not configured for ${prepared.pkg.name}`);
    if (operation.state === "completed") return;

    if (operation.state === "started") {
      await this.reconcileStartedNpmPublish(prepared);
      return;
    }

    await this.ledger.setPhase("external");
    await this.ledger.markNpm(prepared.pkg.name, "started");
    this.crossIrreversibleBoundary("npm publication");
    await this.publishPackage(prepared);
    await this.ledger.markNpm(prepared.pkg.name, "completed");
  }

  private async reconcileStartedNpmPublish(prepared: PreparedNpmPackage): Promise<void> {
    if (!this.ledger) throw new Error("Cannot reconcile npm publication without an active release ledger");
    const artifact = this.ledger.data.artifacts[prepared.pkg.name];
    if (!artifact) throw new Error(`Release artifact is missing for ${prepared.pkg.name}`);
    const registry = this.ledger.data.operations.npmRegistries[prepared.pkg.name];
    if (!registry) throw new Error(`Npm registry is not configured for ${prepared.pkg.name}`);
    const version = prepared.pkg.newVersion ?? prepared.pkg.version;
    const packageSpec = `${prepared.pkg.name}@${version}`;
    const scope = prepared.pkg.name.startsWith("@") ? prepared.pkg.name.split("/")[0] : undefined;
    const scopeRegistryArgs = scope ? [`--${scope}:registry=${registry}`] : [];
    const result = await Bun.$`npm view ${packageSpec} --json --registry ${registry} ${scopeRegistryArgs}`
      .cwd(dirname(prepared.pkg.file))
      .quiet()
      .nothrow();

    if (result.exitCode !== 0) {
      throw new Exit(
        `Cannot safely resume npm publication for ${packageSpec}`,
        "The registry does not confirm the previous upload; inspect the exact package version manually",
      );
    }

    let metadata: unknown;
    try {
      metadata = JSON.parse(result.stdout.toString());
    } catch {
      throw new Exit(`Cannot safely resume npm publication for ${packageSpec}`, "Registry metadata is not valid JSON");
    }

    const published = this.readPublishedPackage(metadata);
    if (
      published?.name !== prepared.pkg.name ||
      published.version !== version ||
      published.integrity !== artifact.integrity
    ) {
      throw new Exit(
        `Cannot safely resume npm publication for ${packageSpec}: artifact integrity does not match`,
        "Do not republish this version; compare the registry artifact with the durable release artifact",
      );
    }

    await this.ledger.markNpm(prepared.pkg.name, "completed");
  }

  private readPublishedPackage(metadata: unknown): { integrity: string; name: string; version: string } | undefined {
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined;
    const name = Reflect.get(metadata, "name");
    const version = Reflect.get(metadata, "version");
    const dist = Reflect.get(metadata, "dist");
    if (typeof dist !== "object" || dist === null || Array.isArray(dist)) return undefined;
    const integrity = Reflect.get(dist, "integrity");
    if (typeof name !== "string" || typeof version !== "string" || typeof integrity !== "string") return undefined;
    return { integrity, name, version };
  }

  private async resolveNpmRegistry(pkg: Package): Promise<string> {
    const scope = pkg.name.startsWith("@") ? pkg.name.split("/")[0] : undefined;
    if (scope) {
      const scopedResult = await Bun.$`npm config get ${`${scope}:registry`}`.cwd(dirname(pkg.file)).quiet().nothrow();
      if (scopedResult.exitCode === 0) {
        const value = scopedResult.stdout.toString().trim();
        if (value && value !== "undefined" && value !== "null") {
          const registry = this.parseNpmRegistry(value);
          if (registry) return registry;
          throw new Exit(
            `Invalid ${scope}:registry for ${pkg.name}`,
            "Registry must be a credential-free HTTP or HTTPS URL",
          );
        }
      }
    }

    const manifest = await this.readPackageManifest(pkg);
    const publishConfig = manifest.publishConfig;
    if (publishConfig !== undefined) {
      if (typeof publishConfig !== "object" || publishConfig === null || Array.isArray(publishConfig)) {
        throw new Exit(`Invalid publishConfig in ${pkg.name}`, "publishConfig must be an object");
      }
      const configuredRegistry = Reflect.get(publishConfig, "registry");
      if (configuredRegistry !== undefined) {
        if (typeof configuredRegistry !== "string") {
          throw new Exit(`Invalid publishConfig.registry in ${pkg.name}`, "Registry must be an HTTP or HTTPS URL");
        }
        const registry = this.parseNpmRegistry(configuredRegistry);
        if (!registry) {
          throw new Exit(
            `Invalid publishConfig.registry in ${pkg.name}`,
            "Registry must be a credential-free HTTP or HTTPS URL",
          );
        }
        return registry;
      }
    }

    const environmentRegistry = process.env.NPM_CONFIG_REGISTRY ?? process.env.npm_config_registry;
    if (environmentRegistry) {
      const registry = this.parseNpmRegistry(environmentRegistry);
      if (registry) return registry;
    }

    for (const key of ["registry"]) {
      const result = await Bun.$`npm config get ${key}`.cwd(dirname(pkg.file)).quiet().nothrow();
      if (result.exitCode !== 0) continue;
      const value = result.stdout.toString().trim();
      if (!value || value === "undefined" || value === "null") continue;

      const registry = this.parseNpmRegistry(value);
      if (registry) return registry;
      break;
    }

    throw new Exit(
      `Cannot resolve a credential-free npm registry for ${pkg.name}`,
      "Configure registry or @scope:registry as an HTTP or HTTPS URL without embedded credentials",
    );
  }

  private parseNpmRegistry(value: string): string | undefined {
    try {
      const url = new URL(value);
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        return undefined;
      }
      return url.href;
    } catch {
      return undefined;
    }
  }

  private getNpmTag(): string {
    const tag = (this.config.get("tag") || DEFAULT_NPM_TAG).trim();
    if (!isValidNpmTag(tag)) {
      throw new Exit(
        `Invalid npm dist-tag "${tag}"`,
        "Use a non-semver tag containing only letters, numbers, dots, underscores, or hyphens",
      );
    }
    return tag;
  }

  private async createProviderRelease(
    provider: GitProvider,
    packageName: string,
    release: { notes: string; tag: string; title: string },
  ): Promise<void> {
    if (!this.ledger) {
      this.crossIrreversibleBoundary("git provider release creation");
      await this.run(() => provider.createRelease(release), `Failed to create release for ${release.tag}`);
      return;
    }

    const operation = this.ledger.data.operations.providerReleases[packageName];
    if (!operation) throw new Error(`Provider release is not configured for ${packageName}`);
    if (operation.state === "completed") return;

    if (operation.state === "started") {
      await this.reconcileStartedProviderRelease(provider, packageName, operation);
      return;
    }

    await this.ledger.setPhase("external");
    await this.ledger.markProviderRelease(packageName, "started");
    this.crossIrreversibleBoundary(`git provider release creation for ${release.tag}`);
    await this.run(() => provider.createRelease(release), `Failed to create release for ${release.tag}`);
    await this.ledger.markProviderRelease(packageName, "completed");
  }

  private async reconcileStartedProviderRelease(
    provider: GitProvider,
    packageName: string,
    operation: ReleaseLedgerProviderReleaseOperation,
  ): Promise<void> {
    const existing = await this.run(
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

  private async getHeadCommit(): Promise<string> {
    const result = await this.run(() => Bun.$`git rev-parse HEAD`.quiet(), "Failed to resolve release commit");
    const commit = result.stdout.toString().trim();
    if (!commit) throw new Error("Release commit is empty");
    return commit;
  }

  private async getHeadReference(): Promise<string | null> {
    const result = await Bun.$`git symbolic-ref -q HEAD`.quiet().nothrow();
    if (result.exitCode === 1) return null;
    if (result.exitCode !== 0) throw new Exit("Failed to resolve the current Git reference");
    return result.stdout.toString().trim() || null;
  }

  private async resolveRef(ref: string): Promise<string | null> {
    const result = await Bun.$`git rev-parse --verify ${ref}`.quiet().nothrow();
    if (result.exitCode !== 0) return null;
    return result.stdout.toString().trim() || null;
  }

  private async getOwnedPaths(packages: Package[], stones: Stone[]): Promise<string[]> {
    const repositoryRoot = await this.getRepositoryRoot();
    const changelogFiles = this.options.changelog ? this.getChangelogFiles(packages) : [];
    const candidates = [
      ...packages.map((pkg) => pkg.file),
      ...changelogFiles,
      join(DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE),
      ...this.stoneManager.getFilePaths(stones),
    ];
    const normalized = [...new Set(candidates.map((path) => this.normalizeOwnedPath(repositoryRoot, path)))].sort();

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

  private async getOwnedMutationFingerprint(paths: readonly string[]): Promise<string> {
    const pathspecs = paths.map((path) => this.toLiteralPathspec(path));
    const [status, staged, unstaged] = await Promise.all([
      Bun.$`git status --porcelain=v1 -z --untracked-files=all -- ${pathspecs}`.quiet(),
      Bun.$`git diff --cached --binary --no-ext-diff -- ${pathspecs}`.quiet(),
      Bun.$`git diff --binary --no-ext-diff -- ${pathspecs}`.quiet(),
    ]);
    const hash = createHash("sha256");
    for (const output of [status.stdout, staged.stdout, unstaged.stdout]) {
      hash.update(String(output.length));
      hash.update("\0");
      hash.update(output);
    }
    return hash.digest("hex");
  }

  private async getRepositoryRoot(): Promise<string> {
    if (this.repositoryRoot) return this.repositoryRoot;

    const result = await this.run(
      () => Bun.$`git rev-parse --show-toplevel`.quiet(),
      "Failed to resolve git repository root",
    );
    const root = result.stdout.toString().trim();
    if (!root) throw new Error("Git repository root is empty");

    this.repositoryRoot = resolve(root);
    return this.repositoryRoot;
  }

  private async validateOwnedPaths(paths: readonly string[]): Promise<void> {
    const repositoryRoot = await this.getRepositoryRoot();
    const realRepositoryRoot = await realpath(repositoryRoot);

    for (const path of paths) {
      const absolutePath = resolve(repositoryRoot, path);
      const pathStatus = await lstat(absolutePath).catch(() => null);
      if (pathStatus?.isSymbolicLink()) {
        throw new Exit(`Release-owned path is a symbolic link: ${path}`);
      }

      const existingPath = pathStatus ? absolutePath : dirname(absolutePath);
      const realExistingPath = await realpath(existingPath);
      const repositoryRelativePath = relative(realRepositoryRoot, realExistingPath);
      if (
        repositoryRelativePath === ".." ||
        repositoryRelativePath.startsWith(`..${sep}`) ||
        isAbsolute(repositoryRelativePath)
      ) {
        throw new Exit(`Release-owned path escapes the repository: ${path}`);
      }
    }
  }

  private async validatePublishSources(): Promise<void> {
    const status = await this.getPublishSourceStatus();
    if (status.length === 0) return;

    throw new Exit(
      "Repository source files changed after the release commit",
      "Commit or stash all source changes before preparing npm artifacts",
    );
  }

  private async getPublishSourceStatus(allowedChanges: readonly string[] = []): Promise<Buffer> {
    const repositoryRoot = await this.getRepositoryRoot();
    await validateReleaseCheckout(repositoryRoot, allowedChanges);
    const result = await this.run(
      () =>
        Bun.$`git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none`.cwd(repositoryRoot).quiet(),
      "Failed to inspect release source files",
    );
    return result.stdout;
  }

  private async validatePublishCommitBinding(commit: string): Promise<void> {
    if (!this.ledger) return;

    const data = this.ledger.data;
    if (!data.releaseCommit || !data.expectedReleaseTree || commit !== data.releaseCommit) {
      throw new Exit(
        `Publish source does not match the recorded release commit for ${data.id}`,
        data.releaseCommit
          ? `Check out ${data.releaseCommit} before publishing`
          : "Resume the release before publishing",
      );
    }
    await this.validateReleaseCommitCandidate(data, commit);
  }

  private async writeExpectedReleaseTree(baseCommit: string, paths: readonly string[]): Promise<string> {
    const repositoryRoot = await this.getRepositoryRoot();
    const tempDir = await mkdtemp(join(tmpdir(), "sisyphus-index-"));
    const indexPath = join(tempDir, "index");
    const env = { ...process.env, GIT_INDEX_FILE: indexPath } as Record<string, string>;
    const pathspecs = paths.map((path) => this.toLiteralPathspec(path));

    try {
      await this.run(
        () => Bun.$`git read-tree ${baseCommit}`.cwd(repositoryRoot).env(env).quiet(),
        "Failed to initialize release tree",
      );
      await this.run(
        () => Bun.$`git add -A -- ${pathspecs}`.cwd(repositoryRoot).env(env).quiet(),
        "Failed to build release tree",
      );

      const result = await this.run(
        () => Bun.$`git write-tree`.cwd(repositoryRoot).env(env).quiet(),
        "Failed to write release tree",
      );
      const tree = result.stdout.toString().trim();
      if (!tree) throw new Error("Git returned an empty release tree object ID");
      return tree;
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  private async ensureExpectedReleaseTree(data: ReleaseLedgerData, candidate: string): Promise<void> {
    if (data.expectedReleaseTree) return;
    if (!this.ledger || !data.options.publishOnly || candidate !== data.baseCommit) {
      throw new Exit(
        `Release ${data.id} has no recorded expected release tree`,
        "No external operation was attempted; inspect the release state manually",
      );
    }

    await this.ledger.setExpectedReleaseTree(await this.getCommitTree(data.baseCommit));
  }

  private async validateReleaseCommitCandidate(data: ReleaseLedgerData, candidate: string): Promise<void> {
    if (!data.expectedReleaseTree) {
      throw new Exit(
        `Release ${data.id} has no recorded expected release tree`,
        "No external operation was attempted; inspect the release state manually",
      );
    }

    if (data.options.publishOnly) {
      if (candidate !== data.baseCommit) {
        throw new Exit(
          `Publish-only release ${data.id} must use commit ${data.baseCommit}, found ${candidate}`,
          `Check out ${data.baseCommit} before resuming`,
        );
      }
    } else {
      await this.validateCommitParent(candidate, data.baseCommit, data.id);
    }

    await this.validateCommitTree(candidate, data.expectedReleaseTree, data.id);
  }

  private async validateCommitParent(commit: string, expectedParent: string, releaseId?: string): Promise<void> {
    const result = await this.run(
      () => Bun.$`git rev-list --parents -n 1 ${commit}`.quiet(),
      "Failed to resolve release commit parent",
    );
    const [resolvedCommit, ...parents] = result.stdout.toString().trim().split(/\s+/);
    if (resolvedCommit === commit && parents.length === 1 && parents[0] === expectedParent) return;

    const release = releaseId ? ` for release ${releaseId}` : "";
    throw new Exit(
      `Release commit parent${release} does not match ${expectedParent}`,
      "No external operation was attempted; inspect the release commit ancestry",
    );
  }

  private async validateCommitTree(commit: string, expectedTree: string, releaseId?: string): Promise<void> {
    const actualTree = await this.getCommitTree(commit);
    if (actualTree === expectedTree) return;

    const release = releaseId ? ` for release ${releaseId}` : "";
    throw new Exit(
      `Release commit tree${release} is ${actualTree}, expected ${expectedTree}`,
      "No external operation was attempted; inspect the release commit for unrelated tracked changes",
    );
  }

  private async getCommitTree(commit: string): Promise<string> {
    const treeish = `${commit}^{tree}`;
    const result = await this.run(
      () => Bun.$`git rev-parse ${treeish}`.quiet(),
      "Failed to resolve release commit tree",
    );
    const tree = result.stdout.toString().trim();
    if (!tree) throw new Error(`Git returned an empty tree object ID for ${commit}`);
    return tree;
  }

  private normalizeOwnedPath(repositoryRoot: string, path: string): string {
    const absolutePath = isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path);
    const repositoryRelativePath = relative(repositoryRoot, absolutePath);
    const isOutsideRepository =
      repositoryRelativePath === ".." ||
      repositoryRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(repositoryRelativePath);

    if (!repositoryRelativePath || isOutsideRepository) {
      throw new Exit(`Release-owned path is outside the repository: ${path}`);
    }

    return repositoryRelativePath.split(sep).join("/");
  }

  private toLiteralPathspec(path: string): string {
    return `:(top,literal)${path}`;
  }

  private async unstageOwnedPaths(ownedPaths: string[]): Promise<void> {
    const pathspecs = ownedPaths.map((path) => this.toLiteralPathspec(path));
    await this.run(
      () => Bun.$`git reset --quiet HEAD -- ${pathspecs}`.quiet(),
      "Failed to unstage release-owned files",
    );
  }

  private async getPublishablePackages(packages: Package[]): Promise<Package[]> {
    const publishablePackages: Package[] = [];

    for (const pkg of packages) {
      const manifest = await this.readPackageManifest(pkg);
      const privateValue = manifest.private;

      if (privateValue !== undefined && typeof privateValue !== "boolean") {
        throw new Error(`Failed to validate ${pkg.name} manifest: "private" must be a boolean`);
      }
      if (privateValue) continue;

      publishablePackages.push(pkg);
    }

    return publishablePackages;
  }

  private async readPackageManifest(pkg: Package): Promise<Record<string, unknown>> {
    let content: string;
    try {
      content = await readFile(pkg.file, "utf-8");
    } catch (error) {
      throw new Error(`Failed to read ${pkg.name}: ${this.getErrorDetail(error)}`);
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse ${pkg.name}: ${this.getErrorDetail(error)}`);
    }

    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
      throw new Error(`Invalid ${pkg.name} manifest object`);
    }

    return manifest as Record<string, unknown>;
  }

  private getPackageSetKey(packages: Package[]): string {
    return packages.map((pkg) => `${pkg.name}\u0000${pkg.file}`).join("\u0000");
  }

  private async publishPackage(prepared: PreparedNpmPackage): Promise<void> {
    const tag = this.ledger?.data.options.npmTag ?? this.getNpmTag();
    const registry = this.ledger?.data.operations.npmRegistries[prepared.pkg.name];
    const registryArgs = registry ? ["--registry", registry] : [];
    const scope = prepared.pkg.name.startsWith("@") ? prepared.pkg.name.split("/")[0] : undefined;
    const scopeRegistryArgs = registry && scope ? [`--${scope}:registry=${registry}`] : [];
    await this.run(
      () =>
        Bun.$`npm publish ${prepared.artifactPath} --tag ${tag} --access public --ignore-scripts ${registryArgs} ${scopeRegistryArgs}`
          .cwd(dirname(prepared.pkg.file))
          .quiet(),
      `Failed to publish ${prepared.pkg.name}`,
    );
  }

  private async prepareNpmArtifact(pkg: Package, artifactPath: string): Promise<void> {
    const packageDirectory = dirname(pkg.file);
    let stagingDirectory: string | null = null;
    try {
      const sourceCommit = await this.getHeadCommit();
      await this.validatePublishCommitBinding(sourceCommit);
      const sourceStatus = await this.getPublishSourceStatus();
      if (sourceStatus.length > 0) {
        throw new Exit(
          "Repository source files changed after the release commit",
          "Commit or stash all source changes before preparing npm artifacts",
        );
      }
      await this.validateIgnoredBuildInputs();
      await this.validateExistingPackInputs(pkg, packageDirectory);
      await this.run(() => Bun.$`bun run build`.cwd(packageDirectory).quiet(), `Failed to build ${pkg.name}`);
      const builtSourceCommit = await this.getHeadCommit();
      await this.validatePublishCommitBinding(builtSourceCommit);
      const builtSourceStatus = await this.getPublishSourceStatus();
      if (builtSourceCommit !== sourceCommit || builtSourceStatus.length > 0) {
        throw new Exit(
          `Package build changed repository source files for ${pkg.name}`,
          "This package was not packed and nothing was published; restore the build changes before retrying",
        );
      }

      const builtText = await readFile(pkg.file, "utf-8");
      const { catalogs, workspaceVersions } = await this.getPublishContext();
      const publishText = renderPublishManifest(builtText, catalogs, workspaceVersions);
      const publishManifest = JSON.parse(publishText) as { name?: unknown; version?: unknown };
      const expectedVersion = pkg.newVersion ?? pkg.version;
      if (publishManifest.name !== pkg.name || publishManifest.version !== expectedVersion) {
        throw new Error(
          `Packed manifest identity mismatch for ${pkg.name}: expected ${pkg.name}@${expectedVersion}, found ${String(publishManifest.name)}@${String(publishManifest.version)}`,
        );
      }

      stagingDirectory = await this.stagePackageForPack(packageDirectory, publishText);
      const packedIdentity = await this.packNpmArtifact(stagingDirectory, artifactPath);
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
      const packedSourceCommit = await this.getHeadCommit();
      await this.validatePublishCommitBinding(packedSourceCommit);
      const packedSourceStatus = await this.getPublishSourceStatus();
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

  private async packNpmArtifact(packageDirectory: string, artifactPath: string): Promise<PackedPackageIdentity> {
    const artifactDirectory = dirname(artifactPath);
    const result = await Bun.$`npm pack --ignore-scripts --json --pack-destination ${artifactDirectory}`
      .cwd(packageDirectory)
      .quiet();
    const output = JSON.parse(result.stdout.toString()) as Array<{
      filename?: unknown;
      name?: unknown;
      version?: unknown;
    }>;
    const packed = output[0];
    if (
      typeof packed?.filename !== "string" ||
      !packed.filename ||
      typeof packed.name !== "string" ||
      !packed.name ||
      typeof packed.version !== "string" ||
      !packed.version
    ) {
      throw new Error("npm pack did not return a valid artifact identity");
    }

    const generatedPath = resolve(artifactDirectory, packed.filename);
    const artifactRelativePath = relative(artifactDirectory, generatedPath);
    if (
      artifactRelativePath === ".." ||
      artifactRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(artifactRelativePath)
    ) {
      throw new Error("npm pack returned an artifact outside the destination directory");
    }
    if (generatedPath !== resolve(artifactPath)) await rename(generatedPath, artifactPath);
    return { name: packed.name, version: packed.version };
  }

  private async stagePackageForPack(packageDirectory: string, publishManifest: string): Promise<string> {
    const result = await Bun.$`npm pack --dry-run --ignore-scripts --json`.cwd(packageDirectory).quiet();
    const output = JSON.parse(result.stdout.toString()) as Array<{ files?: unknown }>;
    const files = output[0]?.files;
    if (!Array.isArray(files)) throw new Error("npm pack did not return a package file list after build");
    const stagingDirectory = await mkdtemp(join(tmpdir(), "sisyphus-package-stage-"));

    try {
      for (const file of files) {
        if (typeof file !== "object" || file === null || Array.isArray(file) || !("path" in file)) {
          throw new Error("npm pack returned an invalid package file entry after build");
        }
        const path = (file as { path?: unknown }).path;
        if (typeof path !== "string" || !path) throw new Error("npm pack returned an invalid package file path");
        const source = resolve(packageDirectory, path);
        const packageRelativePath = relative(packageDirectory, source);
        if (
          packageRelativePath === ".." ||
          packageRelativePath.startsWith(`..${sep}`) ||
          isAbsolute(packageRelativePath)
        ) {
          throw new Exit(`Package includes a file outside its directory: ${path}`);
        }
        const destination = resolve(stagingDirectory, path);
        await mkdir(dirname(destination), { recursive: true });
        await cp(source, destination, { errorOnExist: true, force: false, recursive: false, verbatimSymlinks: true });
      }
      await writeFile(join(stagingDirectory, "package.json"), publishManifest, "utf-8");
      return stagingDirectory;
    } catch (error) {
      try {
        await rm(stagingDirectory, { force: true, recursive: true });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Failed to clean staged npm package");
      }
      throw error;
    }
  }

  private async validateExistingPackInputs(pkg: Package, packageDirectory: string): Promise<void> {
    const repositoryRoot = await this.getRepositoryRoot();
    const [packResult, trackedPaths] = await Promise.all([
      Bun.$`npm pack --dry-run --ignore-scripts --json`.cwd(packageDirectory).quiet(),
      this.collectTrackedPaths(repositoryRoot),
    ]);
    const packOutput = JSON.parse(packResult.stdout.toString()) as Array<{ files?: unknown }>;
    const files = packOutput[0]?.files;
    if (!Array.isArray(files)) throw new Error(`npm pack did not return a file list for ${pkg.name}`);

    for (const file of files) {
      if (typeof file !== "object" || file === null || Array.isArray(file) || !("path" in file)) {
        throw new Error(`npm pack returned an invalid file entry for ${pkg.name}`);
      }
      const path = (file as { path?: unknown }).path;
      if (typeof path !== "string" || !path) {
        throw new Error(`npm pack returned an invalid file path for ${pkg.name}`);
      }
      const absolutePath = resolve(packageDirectory, path);
      const packageRelativePath = relative(packageDirectory, absolutePath);
      if (
        packageRelativePath === ".." ||
        packageRelativePath.startsWith(`..${sep}`) ||
        isAbsolute(packageRelativePath)
      ) {
        throw new Exit(`Package ${pkg.name} includes a file outside its directory: ${path}`);
      }
      const repositoryPath = relative(repositoryRoot, absolutePath).split(sep).join("/");
      if (!trackedPaths.has(repositoryPath)) {
        throw new Exit(`Package ${pkg.name} includes an untracked or ignored pre-build file: ${path}`);
      }
    }
  }

  private async validateIgnoredBuildInputs(): Promise<void> {
    if (this.ignoredBuildInputsValidated) return;
    await this.validateRepositoryIgnoredInputs(await this.getRepositoryRoot(), "");
    this.ignoredBuildInputsValidated = true;
  }

  private async validateRepositoryIgnoredInputs(root: string, prefix: string): Promise<void> {
    const [ignoredResult, indexResult] = await Promise.all([
      Bun.$`git ls-files --others --ignored --exclude-standard -z`.cwd(root).quiet(),
      Bun.$`git ls-files --stage -z --cached`.cwd(root).quiet(),
    ]);
    const ignoredInput = ignoredResult.stdout
      .toString()
      .split("\0")
      .filter(Boolean)
      .find((path) => !path.split("/").includes("node_modules"));
    if (ignoredInput) {
      throw new Exit(
        `Repository contains an ignored build input outside node_modules: ${prefix}${ignoredInput}`,
        "Remove ignored source and stale build outputs before preparing npm artifacts",
      );
    }

    for (const record of indexResult.stdout.toString().split("\0").filter(Boolean)) {
      const separatorIndex = record.indexOf("\t");
      const [mode] = (separatorIndex < 0 ? "" : record.slice(0, separatorIndex)).split(" ");
      const path = separatorIndex < 0 ? "" : record.slice(separatorIndex + 1);
      if (mode === "160000" && path) {
        await this.validateRepositoryIgnoredInputs(resolve(root, path), `${prefix}${path}/`);
      }
    }
  }

  private async collectTrackedPaths(repositoryRoot: string, prefix = ""): Promise<Set<string>> {
    const result = await Bun.$`git ls-files --stage -z --cached`.cwd(repositoryRoot).quiet();
    const paths = new Set<string>();

    for (const record of result.stdout.toString().split("\0").filter(Boolean)) {
      const separatorIndex = record.indexOf("\t");
      const fields = separatorIndex < 0 ? [] : record.slice(0, separatorIndex).split(" ");
      const [mode, , stage, ...unexpected] = fields;
      const path = separatorIndex < 0 ? "" : record.slice(separatorIndex + 1);
      if (!mode || !stage || unexpected.length > 0 || !path) {
        throw new Error("Unable to parse Git index while collecting tracked package inputs");
      }
      if (stage !== "0") throw new Exit(`Repository has an unresolved index entry: ${path}`);
      const prefixedPath = `${prefix}${path}`;
      paths.add(prefixedPath);
      if (mode !== "160000") continue;
      const nestedPaths = await this.collectTrackedPaths(resolve(repositoryRoot, path), `${prefixedPath}/`);
      for (const nestedPath of nestedPaths) paths.add(nestedPath);
    }
    return paths;
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

  private async resolvePushTarget(): Promise<PushTarget> {
    const branchResult = await Bun.$`git symbolic-ref --quiet --short HEAD`.quiet().nothrow();
    if (branchResult.exitCode !== 0) {
      throw new Exit(
        "Cannot push a release from detached HEAD",
        "Check out the branch that should receive the release",
      );
    }

    const branch = branchResult.stdout.toString().trim();
    if (!branch) {
      throw new Exit("Cannot resolve the current branch", "Check out the branch that should receive the release");
    }

    const remote = await this.resolvePushRemote(branch);

    return { branch, remote };
  }

  private async resolvePushRemote(branch?: string): Promise<string> {
    const pushRemote = branch ? await this.readOptionalGitConfig(`branch.${branch}.pushRemote`) : null;
    const defaultRemote = await this.readOptionalGitConfig("remote.pushDefault");
    const trackingRemote = branch ? await this.readOptionalGitConfig(`branch.${branch}.remote`) : null;
    let remote = pushRemote ?? defaultRemote ?? trackingRemote;

    if (!remote) {
      const remotesResult = await this.run(() => Bun.$`git remote`.quiet(), "Failed to list git remotes");
      const remotes = remotesResult.stdout.toString().trim().split("\n").filter(Boolean);
      if (remotes.length === 1 && remotes[0] === "origin") remote = "origin";
    }

    if (!remote) {
      const branchContext = branch ? ` for branch ${branch}` : "";
      throw new Exit(
        `No push remote is configured${branchContext}`,
        branch ? "Configure a branch push remote or remote.pushDefault" : "Configure remote.pushDefault",
      );
    }

    await this.run(() => Bun.$`git remote get-url --push ${remote}`.quiet(), `Invalid push remote ${remote}`);
    return remote;
  }

  private async cleanupPreparedNpmPublish(): Promise<void> {
    const tempDir = this.preparedNpmPublish?.tempDir;
    this.preparedNpmPublish = null;
    if (tempDir) await rm(tempDir, { force: true, recursive: true });
  }

  private async readOptionalGitConfig(key: string): Promise<string | null> {
    const result = await Bun.$`git config --get ${key}`.quiet().nothrow();
    if (result.exitCode === 1) return null;
    if (result.exitCode !== 0) {
      const detail = result.stderr.toString().trim();
      throw new Error(detail ? `Failed to read git config ${key}: ${detail}` : `Failed to read git config ${key}`);
    }

    const value = result.stdout.toString().trim();
    if (!value) throw new Error(`Git config ${key} is empty`);
    return value;
  }

  private crossIrreversibleBoundary(operation: string): void {
    this.irreversibleOperation ??= operation;
  }

  private formatCommitMessage(stone: Stone, packages: Package[]): string {
    const template = this.config.get("commit").message;
    const packageList = packages.map((pkg) => `- ${pkg.name}@${pkg.newVersion ?? pkg.version}`).join("\n");

    const subject = template
      .replace("{message}", () => stone.message)
      .replace("{packages}", () => packages.map((pkg) => pkg.name).join(", "));

    return `${subject}\n\n${packageList}`;
  }

  private async run<T>(fn: () => Promise<T>, context: string): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const detail = this.getErrorDetail(error);
      throw new Error(detail ? `${context}: ${detail}` : context);
    }
  }

  private getErrorDetail(error: unknown): string {
    const stderr = this.getStderr(error);
    if (stderr) return stderr;
    return error instanceof Error ? error.message : String(error);
  }

  private getStderr(error: unknown): string | undefined {
    if (error && typeof error === "object" && "stderr" in error) {
      const stderr = error.stderr;
      if (stderr instanceof Buffer) return stderr.toString().trim();
      if (typeof stderr === "string") return stderr.trim();
    }
    return undefined;
  }
}

async function readPackedManifest(artifactPath: string): Promise<string> {
  const compressed = new Uint8Array(await Bun.file(artifactPath).arrayBuffer());
  const archive = Bun.gunzipSync(compressed);
  const decoder = new TextDecoder();

  for (let offset = 0; offset + TAR_BLOCK_SIZE <= archive.length; ) {
    const name = readTarString(archive, offset, TAR_NAME_LENGTH, decoder);
    if (!name) break;
    const prefix = readTarString(archive, offset + TAR_PREFIX_OFFSET, TAR_PREFIX_LENGTH, decoder);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = readTarString(archive, offset + TAR_SIZE_OFFSET, TAR_SIZE_LENGTH, decoder).trim();
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid tar entry size for ${path}`);
    const contentOffset = offset + TAR_BLOCK_SIZE;
    const contentEnd = contentOffset + size;
    if (contentEnd > archive.length) throw new Error(`Truncated tar entry for ${path}`);
    if (path === PACKED_MANIFEST_PATH) return decoder.decode(archive.subarray(contentOffset, contentEnd));
    offset = contentOffset + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }

  throw new Error("Packed artifact does not contain package/package.json");
}

function readTarString(archive: Uint8Array, offset: number, length: number, decoder: TextDecoder): string {
  const field = archive.subarray(offset, offset + length);
  const terminator = field.indexOf(0);
  return decoder.decode(terminator < 0 ? field : field.subarray(0, terminator));
}

function sameJsonDocument(first: string, second: string): boolean {
  return JSON.stringify(canonicalizeJson(JSON.parse(first))) === JSON.stringify(canonicalizeJson(JSON.parse(second)));
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  );
}
