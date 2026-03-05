import { dirname, join } from "node:path";
import { type ConfigManager, Exit } from "@r5n/cli-core";
import type { Package, Stone } from "../domain";
import type { SisyphusConfig } from "../types";
import { ChangelogGenerator } from "./ChangelogGenerator";
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
  private options: ReleaseOptions;
  private createdTags: string[] = [];
  private commitCreated = false;

  constructor(
    private config: ConfigManager<SisyphusConfig>,
    options: ReleaseOptions,
  ) {
    this.options = options;
    this.changelogGenerator = new ChangelogGenerator(this.config.get("changelog"));
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
    const allFiles = [...files, ...changelogFiles];

    const message = this.formatCommitMessage(stone, packages);
    await this.run(() => Bun.$`git add -- ${allFiles}`.quiet(), "Failed to stage files");
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
  }

  async createGithubRelease(_stone: Stone, _packages: Package[]) {
    if (this.options.dryRun) return;
    // TODO: Implement GitHub release creation
  }

  async rollback() {
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
    const packageList = packages.map((pkg) => `- ${pkg.name}@${pkg.newVersion}`).join("\n");
    return `chore(release): ${stone.message}\n\n${packageList}`;
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
