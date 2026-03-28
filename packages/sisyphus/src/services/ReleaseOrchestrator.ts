import { dirname, join } from "node:path";
import { type ConfigManager, color, Exit, log } from "@r5n/cli-core";
import { DEFAULT_NPM_TAG } from "../constants";
import type { CommitInfo, Package, Stone } from "../domain";
import { createGitProvider, type GitProvider } from "../providers";
import type { SisyphusConfig } from "../types";
import { ChangelogGenerator } from "./ChangelogGenerator";
import { GitRemoteParser } from "./GitRemoteParser";
import { PackageUpdater } from "./PackageUpdater";

export type ReleaseOptions = {
  changelog: boolean;
  createRelease: boolean;
  dryRun: boolean;
  npm: boolean;
  push: boolean;
  tags: boolean;
};

export class ReleaseOrchestrator {
  private packageUpdater = new PackageUpdater();
  private changelogGenerator: ChangelogGenerator;
  private remoteParser = new GitRemoteParser();
  private provider: GitProvider | null = null;
  private commitUrlFn: ((hash: string) => string) | null = null;
  private options: ReleaseOptions;
  private createdTags: string[] = [];
  private createdReleases: string[] = [];
  private commitCreated = false;
  private pushedToRemote = false;

  constructor(
    private config: ConfigManager<SisyphusConfig>,
    options: ReleaseOptions,
  ) {
    this.options = options;
    this.changelogGenerator = new ChangelogGenerator(this.config.get("changelog"));
  }

  private async getProvider(): Promise<GitProvider> {
    if (!this.provider) {
      this.provider = await createGitProvider();
    }
    return this.provider;
  }

  private async initCommitLinks() {
    if (this.commitUrlFn !== null) return;
    const remoteInfo = await this.remoteParser.getRemoteInfo();
    this.commitUrlFn = remoteInfo?.commitUrl ?? null;
  }

  async preflight(packages: Package[]) {
    if (this.options.dryRun) return;

    const hasStagedChanges = await this.hasStagedChanges();
    if (hasStagedChanges) {
      throw new Exit("You have staged changes", "Commit or stash them before running roll");
    }

    const dirtyFiles = await this.getDirtyPackageFiles(packages);
    if (dirtyFiles.length > 0) {
      throw new Exit("Package files have uncommitted changes", `Commit or stash changes in:\n${dirtyFiles.join("\n")}`);
    }
  }

  async updatePackageVersions(packages: Package[]) {
    if (this.options.dryRun) return;
    await this.packageUpdater.updateAll(packages);
  }

  async generateChangelogs(stones: Stone[], packages: Package[]) {
    if (this.options.dryRun) return;
    await this.changelogGenerator.generate(stones, packages);
  }

  async createCommit(stone: Stone, packages: Package[]) {
    if (this.options.dryRun) return;

    const files = packages.map((pkg) => pkg.file);
    const changelogFiles = this.getChangelogFiles(packages);
    const sisyphusDir = this.config.get("sisyphusDir");
    const allFiles = [...files, ...changelogFiles, sisyphusDir];

    const message = this.formatCommitMessage(stone, packages);
    const authorArg = this.getCommitAuthorArg();

    await this.run(() => Bun.$`git add -A -- ${allFiles}`.quiet(), "Failed to stage files");
    await this.run(() => Bun.$`git commit ${authorArg} -m ${message}`.quiet(), "Failed to create commit");
    this.commitCreated = true;
  }

  private getCommitAuthorArg(): string[] {
    const { author, email } = this.config.get("commit");
    if (!author) return [];
    const authorString = email ? `${author} <${email}>` : author;
    return ["--author", authorString];
  }

  private getChangelogFiles(packages: Package[]): string[] {
    const filename = this.config.get("changelog").filename;
    const files = packages.map((pkg) => join(dirname(pkg.file), filename));

    if (this.config.get("changelog").root) {
      files.push(filename);
    }

    return files;
  }

  async createGitTags(packages: Package[]) {
    if (this.options.dryRun) return;

    for (const pkg of packages) {
      const version = pkg.newVersion ?? pkg.version;
      const tagName = `${pkg.name}@${version}`;
      await this.run(() => Bun.$`git tag ${tagName}`.quiet(), `Failed to create tag ${tagName}`);
      this.createdTags.push(tagName);
    }
  }

  async publishToNpm(packages: Package[]) {
    if (this.options.dryRun) return;

    for (const pkg of packages) {
      await this.publishPackage(pkg);
    }
  }

  async pushToRemote() {
    if (this.options.dryRun) return;

    await this.run(() => Bun.$`git push`.quiet(), "Failed to push commits");

    if (this.createdTags.length > 0) {
      await this.pushTags();
    }

    this.pushedToRemote = true;
  }

  async pushTags() {
    if (this.options.dryRun) return;
    if (this.createdTags.length === 0) return;

    await this.run(() => Bun.$`git push --tags`.quiet(), "Failed to push tags");
  }

  async createGitRelease(stones: Stone[], packages: Package[]) {
    if (this.options.dryRun) return;

    await this.initCommitLinks();
    const provider = await this.getProvider();

    for (const pkg of packages) {
      const version = pkg.newVersion ?? pkg.version;
      const tagName = `${pkg.name}@${version}`;
      const title = `${pkg.name} v${version}`;
      const relevantStones = this.filterStonesForPackage(stones, pkg.name);
      const notes = this.formatReleaseNotes(relevantStones, pkg);

      await this.run(
        () => provider.createRelease({ notes, tag: tagName, title }),
        `Failed to create release for ${tagName}`,
      );
      this.createdReleases.push(tagName);
    }
  }

  private filterStonesForPackage(stones: Stone[], packageName: string): Stone[] {
    return stones.filter((s) => s.affectsPackage(packageName));
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
    return commits.filter((c) => c.packages.includes(packageName));
  }

  private formatCommitLine(commit: CommitInfo): string {
    const hashDisplay = this.commitUrlFn
      ? `[\`${commit.hash}\`](${this.commitUrlFn(commit.hash)})`
      : `\`${commit.hash}\``;
    return `- ${hashDisplay} ${commit.subject}`;
  }

  async rollback() {
    if (this.createdReleases.length > 0) {
      const provider = await this.getProvider();
      for (const release of this.createdReleases) {
        await provider.deleteRelease(release);
      }
    }
    this.createdReleases = [];

    if (this.pushedToRemote) {
      for (const tag of this.createdTags) {
        try {
          await Bun.$`git push origin --delete ${tag}`.quiet();
        } catch (error) {
          log.warn(color.dim(`Failed to delete remote tag "${tag}": ${error}`));
        }
      }
    }

    for (const tag of this.createdTags) {
      try {
        await Bun.$`git tag -d ${tag}`.quiet();
      } catch (error) {
        log.warn(color.dim(`Failed to delete local tag "${tag}": ${error}`));
      }
    }
    this.createdTags = [];

    if (this.commitCreated) {
      try {
        await Bun.$`git reset HEAD~1`.quiet();
      } catch (error) {
        log.warn(color.dim(`Failed to reset commit: ${error}`));
      }
      this.commitCreated = false;
    }

    await this.changelogGenerator.rollback();
    await this.packageUpdater.rollback();
  }

  private async publishPackage(pkg: Package) {
    const tag = this.config.get("tag") || DEFAULT_NPM_TAG;
    const pkgDir = dirname(pkg.file);

    await this.run(() => Bun.$`bun run build`.cwd(pkgDir).quiet(), `Failed to build ${pkg.name}`);
    await this.run(
      () => Bun.$`npm publish --tag ${tag} --access public`.cwd(pkgDir).quiet(),
      `Failed to publish ${pkg.name}`,
    );
  }

  private formatCommitMessage(stone: Stone, packages: Package[]): string {
    const template = this.config.get("commit").message;
    const packageList = packages.map((pkg) => `- ${pkg.name}@${pkg.newVersion ?? pkg.version}`).join("\n");

    const subject = template
      .replace("{message}", () => stone.message)
      .replace("{packages}", () => packages.map((p) => p.name).join(", "));

    return `${subject}\n\n${packageList}`;
  }

  private async hasStagedChanges(): Promise<boolean> {
    try {
      const result = await Bun.$`git diff --cached --name-only`.quiet();
      return result.stdout.toString().trim().length > 0;
    } catch {
      return false;
    }
  }

  private async getDirtyPackageFiles(packages: Package[]): Promise<string[]> {
    const dirty: string[] = [];
    for (const pkg of packages) {
      try {
        const result = await Bun.$`git status --porcelain ${pkg.file}`.quiet();
        if (result.stdout.toString().trim().length > 0) {
          dirty.push(pkg.file);
        }
      } catch {}
    }
    return dirty;
  }

  private async run(fn: () => Promise<unknown>, context: string) {
    try {
      await fn();
    } catch (error) {
      const detail = this.getStderr(error) ?? (error instanceof Error ? error.message : undefined);
      throw new Error(detail ? `${context}: ${detail}` : context);
    }
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
