import { args, color, Exit, log, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { Package, Stone } from "../../domain";
import { createGitProvider, type GitProvider } from "../../providers";
import {
  buildReleasePrTitle,
  ChangelogGenerator,
  CommitAnalyzer,
  dependentsOptions,
  explainEmptyRelease,
  hashReleasePlan,
  hashReleaseSource,
  orderForRelease,
  PackageUpdater,
  StoneManager,
  stripIgnoredFromStones,
  WorkspaceScanner,
} from "../../services";
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
    }
    return this.provider;
  }

  async execute(ctx: ReleasePrCtx) {
    const originalRef = await this.checkoutReleaseBranch();

    try {
      const { stones, packages } = await this.collectReleaseData(ctx);

      if (stones.length === 0) {
        log.info(color.dim("No pending stones found, skipping release PR"));
        return;
      }

      const prTitle = this.buildPrTitle(packages);
      const prBody = this.buildPrBody(packages, stones);

      log.info(`${color.bold("Release PR:")} ${prTitle}`);
      log.info(`${color.dim("Packages:")} ${packages.map((p) => p.name).join(", ")}`);

      if (ctx.args.dryRun) {
        log.info(color.yellow("\n[dry-run] Would create/update release PR"));
        log.info(color.dim("\nPR Body preview:"));
        log.info(prBody);
        return;
      }

      await this.commitAndPushChanges(ctx, stones, packages);
      await this.createOrUpdatePr(prTitle, prBody);
    } finally {
      await this.restoreBranch(originalRef);
    }
  }

  private async checkoutReleaseBranch(): Promise<string> {
    const status = await Bun.$`git status --porcelain=v1 --untracked-files=all`.quiet();
    if (status.stdout.length > 0) {
      throw new Exit(
        "Working tree must be clean before preparing a release PR",
        "Commit or stash your changes before running sis actions release-pr",
      );
    }
    const branch = await Bun.$`git branch --show-current`.quiet();
    const originalRef =
      branch.stdout.toString().trim() || (await Bun.$`git rev-parse HEAD`.quiet()).stdout.toString().trim();
    const provider = await this.getProvider();
    const baseBranch = await provider.getDefaultBranch();

    await Bun.$`git fetch origin ${baseBranch}`;
    await Bun.$`git checkout -B ${RELEASE_BRANCH} origin/${baseBranch}`;

    return originalRef;
  }

  private async collectReleaseData(ctx: ReleasePrCtx): Promise<{ stones: Stone[]; packages: Package[] }> {
    const manager = new StoneManager(ctx.config);
    const generatedStones = await this.generateStonesFromCommits(ctx, manager, ctx.args.dryRun);
    const pendingStones = await manager.list();
    const collected = ctx.args.dryRun ? [...pendingStones, ...generatedStones] : pendingStones;

    if (collected.length === 0) return { packages: [], stones: [] };

    const ignore = ctx.config.get("ignore") ?? [];
    const { stones, skipped } = stripIgnoredFromStones(collected, ignore);
    if (skipped.length > 0) {
      log.warn(color.yellow(`Excluded by config.ignore: ${skipped.join(", ")}`));
    }

    const { packages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });
    const mergedStone = Stone.mergeAll(stones);
    const reason = explainEmptyRelease(mergedStone, packages, ignore);
    if (reason.kind === "unknown-packages") {
      throw new Exit(
        `Pending stones reference unknown packages: ${reason.names.join(", ")}`,
        "Remove or update the stale stones before creating a release PR",
      );
    }
    const { cycle, ordered } = orderForRelease(
      Package.applyStone(mergedStone, packages, dependentsOptions(ctx.config).kinds),
    );
    if (cycle.length > 0) {
      log.warn(color.yellow(`Dependency cycle between ${cycle.join(", ")}; publish order may not satisfy every pin`));
    }

    if (ordered.length === 0) {
      log.warn(color.yellow("Pending stones reference no releasable packages"));
      return { packages: [], stones: [] };
    }

    return { packages: ordered, stones };
  }

  private async commitAndPushChanges(ctx: ReleasePrCtx, stones: Stone[], packages: Package[]) {
    const s = spinner();
    s.start("Applying release changes...");

    const sourceFiles = [
      ...(await this.updatePackages(packages)),
      ...(await this.generateChangelogs(ctx, stones, packages)),
    ];
    const timestamp = await this.archiveStones(ctx, stones);
    await this.stageFiles(sourceFiles);
    await this.recordCurrentRelease(ctx, stones, packages, timestamp);
    await this.stageFiles([ctx.config.get("sisyphusDir")]);

    const hasChanges = await Bun.$`git diff --cached --quiet`.nothrow();
    if (hasChanges.exitCode !== 0) {
      await Bun.$`git commit -m ${`${PR_TITLE_PREFIX} prepare release`}`;
    }

    await Bun.$`git push origin ${RELEASE_BRANCH} --force`;
    s.stop("Release branch ready");
  }

  private async createOrUpdatePr(title: string, body: string) {
    const s = spinner();
    const existingPr = await this.findExistingReleasePr();

    if (existingPr) {
      s.start("Updating PR...");
      await this.updatePr(existingPr.number, title, body);
      s.stop(`PR #${existingPr.number} updated`);
      log.info(`\n${color.green("Release PR updated:")} ${existingPr.url}`);
    } else {
      s.start("Creating PR...");
      const pr = await this.createPr(title, body);
      s.stop(`PR #${pr.number} created`);
      log.info(`\n${color.green("Release PR created:")} ${pr.url}`);
    }
  }

  private buildPrTitle(packages: Package[]): string {
    return buildReleasePrTitle(PR_TITLE_PREFIX, packages);
  }

  private buildPrBody(packages: Package[], stones: Stone[]): string {
    const sections = [
      this.buildChangesSection(stones),
      this.buildPackagesSection(packages),
      this.buildStonesSection(stones),
      this.buildFooter(),
    ];
    return sections.join("\n");
  }

  private buildChangesSection(stones: Stone[]): string {
    const lines = ["## Changes", ""];
    for (const s of stones) {
      lines.push(`### ${s.message}`, "");
      if (s.commits && s.commits.length > 0) {
        for (const commit of s.commits) {
          lines.push(`- ${commit.message} (\`${commit.hash}\`)`);
        }
      } else if (s.description) {
        lines.push(s.description);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  private buildPackagesSection(packages: Package[]): string {
    const lines = ["## Packages", ""];
    for (const pkg of packages) {
      lines.push(`- \`${pkg.name}\` ${pkg.version} → ${pkg.newVersion}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  private buildStonesSection(stones: Stone[]): string {
    const lines = ["## Stones", ""];
    for (const s of stones) {
      lines.push(`- \`${s.id}\`: ${s.message}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  private buildFooter(): string {
    return [
      "---",
      "*This PR was automatically created by [Sisyphus](https://github.com/r5n-labs/clis).*",
      "*Merging this PR will trigger the release workflow.*",
    ].join("\n");
  }

  private async findExistingReleasePr(): Promise<{ number: number; url: string } | null> {
    const provider = await this.getProvider();
    const pr = await provider.findPr({ head: RELEASE_BRANCH, label: RELEASE_LABEL });
    return pr ? { number: pr.number, url: pr.url } : null;
  }

  private async generateStonesFromCommits(ctx: ReleasePrCtx, manager: StoneManager, dryRun: boolean): Promise<Stone[]> {
    const analyzer = new CommitAnalyzer(ctx.config);
    const commitGroups = await analyzer.analyze({ single: ctx.config.get("single") });

    if (commitGroups.length === 0) return [];

    const { packages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });
    const stones: Stone[] = [];

    for (const [index, group] of commitGroups.entries()) {
      const stoneData = CommitAnalyzer.buildStoneData(group, packages, dependentsOptions(ctx.config));

      if (dryRun) {
        log.info(`${color.dim("[dry-run] Would generate stone:")} ${group.message}`);
        stones.push(Stone.create(stoneData, index));
      } else {
        const stone = await manager.create(stoneData);
        stones.push(stone);
        log.info(`${color.dim("Generated stone:")} ${stone.id}`);
      }
    }

    return stones;
  }

  private async findNewestCommitHash(stones: Stone[]): Promise<string | null> {
    const hashes = stones.flatMap((s) => s.commits ?? []).map((c) => c.hash);
    if (hashes.length === 0) return null;

    const result = await Bun.$`git log -1 --format=%H ${hashes}`.quiet().nothrow();
    return result.stdout.toString().trim() || null;
  }

  private async stageFiles(files: string[]) {
    await Bun.$`git --literal-pathspecs add -- ${files}`;
  }

  private async updatePackages(packages: Package[]): Promise<string[]> {
    const updater = new PackageUpdater();
    await updater.updateAll(packages);
    return packages.map((p) => p.file);
  }

  private async generateChangelogs(ctx: ReleasePrCtx, stones: Stone[], packages: Package[]): Promise<string[]> {
    const changelogConfig = ctx.config.get("changelog");
    if (!changelogConfig.generate) return [];

    const generator = new ChangelogGenerator(changelogConfig);
    await generator.generate(stones, packages);
    return [changelogConfig.filename, `**/${changelogConfig.filename}`];
  }

  private async archiveStones(ctx: ReleasePrCtx, stones: Stone[]): Promise<string> {
    const manager = new StoneManager(ctx.config);
    return manager.archive(stones);
  }

  private async recordCurrentRelease(ctx: ReleasePrCtx, stones: Stone[], packages: Package[], timestamp: string) {
    const packageVersions = this.buildPackageVersions(packages);
    const sourceHash = await hashReleaseSource(ctx.config.get("sisyphusDir"));
    const plan = { packages: packageVersions, sourceHash, stoneIds: stones.map((stone) => stone.id), timestamp };
    ctx.config.set("currentRelease", {
      ...plan,
      planHash: hashReleasePlan(
        plan,
        stones.map((stone) => stone.toJson()),
      ),
    });

    await this.updateLastStone(ctx, stones);
  }

  private buildPackageVersions(packages: Package[]): Record<string, PackageRelease> {
    const versions: Record<string, PackageRelease> = {};
    for (const pkg of packages) {
      if (pkg.newVersion) {
        versions[pkg.name] = { newVersion: pkg.newVersion, oldVersion: pkg.version };
      }
    }
    return versions;
  }

  private async updateLastStone(ctx: ReleasePrCtx, stones: Stone[]) {
    const newestCommit = await this.findNewestCommitHash(stones);
    if (newestCommit) {
      ctx.config.set("lastStone", { commit: newestCommit, date: new Date().toISOString() });
    }
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

  private async restoreBranch(originalRef: string) {
    try {
      await Bun.$`git checkout ${originalRef}`.quiet();
    } catch (error) {
      log.warn(color.dim(`Failed to restore branch: ${error}`));
    }
  }
}
