import { args, color, Exit, log, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { Package, Stone } from "../../domain";
import { createGitProvider, type GitProvider } from "../../providers";
import { ChangelogGenerator, CommitAnalyzer, PackageUpdater, StoneManager, WorkspaceScanner } from "../../services";
import type { PackageRelease } from "../../types";

const RELEASE_BRANCH = "sisyphus/release";
const RELEASE_LABEL = "sisyphus-release";
const RELEASE_LABEL_DESCRIPTION = "Sisyphus release PR";
const RELEASE_LABEL_COLOR = "6f42c1";
const PR_TITLE_PREFIX = "chore(release):";

const releasePrArgs = args({
  dryRun: { alias: "d", default: false, description: "Preview without making changes", type: "boolean" },
});

type ReleasePrCtx = Ctx<typeof releasePrArgs>;

export class ActionsReleasePrCommand extends BaseCommand {
  name = "release-pr";
  description = "Create or update a release PR from pending stones";
  args = releasePrArgs;

  private provider: GitProvider | null = null;

  private async getProvider(): Promise<GitProvider> {
    if (!this.provider) {
      this.provider = await createGitProvider();
      await this.provider.ensureAvailable();
    }
    return this.provider;
  }

  async execute(ctx: ReleasePrCtx) {
    const manager = new StoneManager(ctx.config);

    await this.generateStonesFromCommits(ctx, manager);

    const stones = await manager.list();

    if (stones.length === 0) {
      log.info(color.dim("No pending stones found, skipping release PR"));
      return;
    }

    const { packages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });
    const mergedStone = Stone.mergeAll(stones);
    const updatedPackages = Package.applyStone(mergedStone, packages);

    if (updatedPackages.length === 0) {
      throw new Exit("No packages to update", "Stones don't reference any known packages");
    }

    const prTitle = this.buildPrTitle(updatedPackages);
    const prBody = this.buildPrBody(updatedPackages, stones);

    log.info(`${color.bold("Release PR:")} ${prTitle}`);
    log.info(`${color.dim("Packages:")} ${updatedPackages.map((p) => p.name).join(", ")}`);

    if (ctx.args.dryRun) {
      log.info(color.yellow("\n[dry-run] Would create/update release PR"));
      log.info(color.dim("\nPR Body preview:"));
      log.info(prBody);
      return;
    }

    const s = spinner();

    const existingPr = await this.findExistingReleasePr();

    try {
      if (existingPr) {
        s.start("Updating release branch...");
        await this.updateReleaseBranch(ctx, stones, updatedPackages);
        s.stop("Release branch updated");

        s.start("Updating PR...");
        await this.updatePr(existingPr.number, prTitle, prBody);
        s.stop(`PR #${existingPr.number} updated`);

        log.info(`\n${color.green("Release PR updated:")} ${existingPr.url}`);
      } else {
        s.start("Creating release branch...");
        await this.createReleaseBranch(ctx, stones, updatedPackages);
        s.stop("Release branch created");

        s.start("Creating PR...");
        const pr = await this.createPr(prTitle, prBody);
        s.stop(`PR #${pr.number} created`);

        log.info(`\n${color.green("Release PR created:")} ${pr.url}`);
      }
    } catch (error) {
      s.stop("Failed");
      await this.restoreMainBranch();
      throw error;
    }
  }

  private buildPrTitle(packages: Package[]): string {
    const names = packages.map((p) => `${p.name}@${p.newVersion}`).join(", ");
    return `${PR_TITLE_PREFIX} ${names}`;
  }

  private buildPrBody(packages: Package[], stones: Stone[]): string {
    const lines: string[] = [];

    lines.push("## Changes");
    lines.push("");
    for (const s of stones) {
      lines.push(`### ${s.message}`);
      if (s.description) {
        lines.push("");
        lines.push(s.description);
      }
      lines.push("");
    }

    lines.push("## Packages");
    lines.push("");
    for (const pkg of packages) {
      lines.push(`- \`${pkg.name}\` ${pkg.version} → ${pkg.newVersion}`);
    }
    lines.push("");

    lines.push("## Stones");
    lines.push("");
    for (const s of stones) {
      lines.push(`- \`${s.id}\`: ${s.message}`);
    }
    lines.push("");

    lines.push("---");
    lines.push("*This PR was automatically created by [Sisyphus](https://github.com/r5n-labs/clis).*");
    lines.push("*Merging this PR will trigger the release workflow.*");

    return lines.join("\n");
  }

  private async findExistingReleasePr(): Promise<{ number: number; url: string } | null> {
    const provider = await this.getProvider();
    const pr = await provider.findPr({ head: RELEASE_BRANCH, label: RELEASE_LABEL });
    return pr ? { number: pr.number, url: pr.url } : null;
  }

  private async createReleaseBranch(ctx: ReleasePrCtx, stones: Stone[], packages: Package[]) {
    const provider = await this.getProvider();
    const baseBranch = await provider.getDefaultBranch();

    await this.stashChanges();
    await Bun.$`git checkout -B ${RELEASE_BRANCH} origin/${baseBranch}`;

    const changedFiles = await this.applyReleaseChanges(ctx, stones, packages);

    await Bun.$`git add ${changedFiles}`;
    await Bun.$`git commit -m ${`${PR_TITLE_PREFIX} prepare release`}`;
    await Bun.$`git push -u origin ${RELEASE_BRANCH} --force`;

    await Bun.$`git checkout ${baseBranch}`;
  }

  private async updateReleaseBranch(ctx: ReleasePrCtx, stones: Stone[], packages: Package[]) {
    const provider = await this.getProvider();
    const baseBranch = await provider.getDefaultBranch();

    await Bun.$`git fetch origin ${baseBranch}`;
    await this.stashChanges();
    await Bun.$`git checkout -B ${RELEASE_BRANCH} origin/${baseBranch}`;

    const changedFiles = await this.applyReleaseChanges(ctx, stones, packages);

    await Bun.$`git add ${changedFiles}`;

    const hasChanges = await Bun.$`git diff --cached --quiet`.nothrow();
    if (hasChanges.exitCode !== 0) {
      await Bun.$`git commit -m ${`${PR_TITLE_PREFIX} prepare release`}`;
    }

    await Bun.$`git push origin ${RELEASE_BRANCH} --force`;

    await Bun.$`git checkout ${baseBranch}`;
  }

  private async generateStonesFromCommits(ctx: ReleasePrCtx, manager: StoneManager): Promise<void> {
    const analyzer = new CommitAnalyzer(ctx.config);
    const commitGroups = await analyzer.analyze({ single: ctx.config.get("single") });

    if (commitGroups.length === 0) return;

    const { packages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });

    for (const group of commitGroups) {
      const stoneData = CommitAnalyzer.buildStoneData(group, packages);
      const stone = await manager.create(stoneData);
      log.info(`${color.dim("Generated stone:")} ${stone.id}`);
    }
  }

  private async stashChanges() {
    await Bun.$`git stash --include-untracked`.nothrow();
  }

  private async applyReleaseChanges(ctx: ReleasePrCtx, stones: Stone[], packages: Package[]): Promise<string[]> {
    const changelogConfig = ctx.config.get("changelog");
    const generator = new ChangelogGenerator(changelogConfig);
    const updater = new PackageUpdater();
    const sisyphusDir = ctx.config.get("sisyphusDir");

    const changedFiles: string[] = [];

    await updater.updateAll(packages);
    changedFiles.push(...packages.map((p) => p.file));

    if (changelogConfig.generate) {
      await generator.generate(stones, packages);
      changedFiles.push(changelogConfig.filename, `**/${changelogConfig.filename}`);
    }

    const manager = new StoneManager(ctx.config);
    const timestamp = await manager.archive(stones);

    const packageVersions: Record<string, PackageRelease> = {};
    for (const pkg of packages) {
      if (pkg.newVersion) {
        packageVersions[pkg.name] = { newVersion: pkg.newVersion, oldVersion: pkg.version };
      }
    }

    ctx.config.set("currentRelease", { packages: packageVersions, stoneIds: stones.map((s) => s.id), timestamp });

    changedFiles.push(sisyphusDir);

    return changedFiles;
  }

  private async createPr(title: string, body: string): Promise<{ number: number; url: string }> {
    const provider = await this.getProvider();
    const baseBranch = await provider.getDefaultBranch();

    await provider.ensureLabelExists(RELEASE_LABEL, {
      color: RELEASE_LABEL_COLOR,
      description: RELEASE_LABEL_DESCRIPTION,
    });

    const pr = await provider.createPr({
      base: baseBranch,
      body,
      head: RELEASE_BRANCH,
      labels: [RELEASE_LABEL],
      title,
    });

    return { number: pr.number, url: pr.url };
  }

  private async updatePr(prNumber: number, title: string, body: string) {
    const provider = await this.getProvider();
    await provider.updatePr(prNumber, { body, title });
  }

  private async restoreMainBranch() {
    const provider = await this.getProvider();
    const baseBranch = await provider.getDefaultBranch();
    try {
      await Bun.$`git checkout ${baseBranch}`.quiet();
    } catch {}
  }
}
