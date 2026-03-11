import { dirname, join } from "node:path";
import { type ConfigManager, Exit } from "@r5n/cli-core";
import type { CommitInfo, Package, Stone } from "../domain";
import type { SisyphusConfig } from "../types";
import { ChangelogGenerator } from "./ChangelogGenerator";
import { GitRemoteParser } from "./GitRemoteParser";
import { PackageUpdater } from "./PackageUpdater";

export type ReleaseOptions = {
  changelog: boolean;
  dryRun: boolean;
  github: boolean;
  npm: boolean;
  push: boolean;
  tags: boolean;
};

export class ReleaseOrchestrator {
  private packageUpdater = new PackageUpdater();
  private changelogGenerator: ChangelogGenerator;
  private remoteParser = new GitRemoteParser();
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
    await this.run(() => Bun.$`git add -A -- ${allFiles}`.quiet(), "Failed to stage files");
    await this.run(() => Bun.$`git commit -m ${message}`.quiet(), "Failed to create commit");
    this.commitCreated = true;
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
      const newVersion = pkg.newVersion;
      if (!newVersion) continue;

      const tagName = `${pkg.name}@${newVersion}`;
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
      await this.run(() => Bun.$`git push --tags`.quiet(), "Failed to push tags");
    }

    this.pushedToRemote = true;
  }

  async createGithubRelease(stone: Stone, packages: Package[]) {
    if (this.options.dryRun) return;

    await this.initCommitLinks();

    for (const pkg of packages) {
      if (!pkg.newVersion) continue;

      const tagName = `${pkg.name}@${pkg.newVersion}`;
      const title = `${pkg.name} v${pkg.newVersion}`;
      const notes = this.formatReleaseNotes(stone, pkg);

      await this.run(
        () => Bun.$`gh release create ${tagName} --title ${title} --notes ${notes}`.quiet(),
        `Failed to create GitHub release for ${tagName}`,
      );
      this.createdReleases.push(tagName);
    }
  }

  private formatReleaseNotes(stone: Stone, pkg: Package): string {
    const lines: string[] = [];

    lines.push(`## ${stone.message}`);
    lines.push("");

    if (stone.description) {
      lines.push(stone.description);
      lines.push("");
    }

    lines.push(`**Package:** \`${pkg.name}\``);
    lines.push(`**Version:** ${pkg.version} → ${pkg.newVersion}`);

    const commits = this.filterCommitsForPackage(stone.commits, pkg.name);
    if (commits.length > 0) {
      lines.push("");
      lines.push("<details>");
      lines.push(`<summary>Commits (${commits.length})</summary>`);
      lines.push("");
      for (const commit of commits) {
        lines.push(this.formatCommitLine(commit));
      }
      lines.push("");
      lines.push("</details>");
    }

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
    for (const release of this.createdReleases) {
      try {
        await Bun.$`gh release delete ${release} --yes`.quiet();
      } catch {}
    }
    this.createdReleases = [];

    if (this.pushedToRemote) {
      for (const tag of this.createdTags) {
        try {
          await Bun.$`git push origin --delete ${tag}`.quiet();
        } catch {}
      }
    }

    for (const tag of this.createdTags) {
      try {
        await Bun.$`git tag -d ${tag}`.quiet();
      } catch {}
    }
    this.createdTags = [];

    if (this.commitCreated) {
      try {
        await Bun.$`git reset HEAD~1`.quiet();
      } catch {}
      this.commitCreated = false;
    }

    await this.changelogGenerator.rollback();
    await this.packageUpdater.rollback();
  }

  private async publishPackage(pkg: Package) {
    const newVersion = pkg.newVersion;
    if (!newVersion) return;

    const tag = this.config.get("tag") || "latest";
    const pkgDir = dirname(pkg.file);

    await this.run(() => Bun.$`bun run build`.cwd(pkgDir).quiet(), `Failed to build ${pkg.name}`);
    await this.run(
      () => Bun.$`npm publish --tag ${tag} --access public`.cwd(pkgDir).quiet(),
      `Failed to publish ${pkg.name}`,
    );
  }

  private formatCommitMessage(stone: Stone, packages: Package[]): string {
    const template = this.config.get("commit").message;
    const packageList = packages.map((pkg) => `- ${pkg.name}@${pkg.newVersion}`).join("\n");

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
      const stderr = this.getStderr(error);
      throw new Exit(context, stderr);
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
