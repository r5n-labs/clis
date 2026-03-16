import { args, color, confirm, Exit, log, note, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN } from "../constants";
import { Package, Stone } from "../domain";
import { ChangelogGenerator, ReleaseOrchestrator, StoneManager, WorkspaceScanner } from "../services";

const rollArgs = args({
  changelog: { alias: "c", description: "Generate changelogs", type: "boolean" },
  createRelease: { alias: "r", description: "Create a release on git provider", type: "boolean" },
  dryRun: { alias: "d", default: false, description: "Preview without making changes", type: "boolean" },
  noCommit: { default: false, description: "Skip creating release commit", type: "boolean" },
  npm: { alias: "n", description: "Publish to NPM", type: "boolean" },
  preview: { default: false, description: "Preview changelogs then prompt to delete", type: "boolean" },
  publishOnly: { default: false, description: "Publish from currentRelease (no file changes)", type: "boolean" },
  push: { alias: "p", description: "Push commits and tags to remote", type: "boolean" },
  tags: { alias: "t", description: "Create git tags", type: "boolean" },
  yes: { alias: "y", default: false, description: "Skip confirmation prompts", type: "boolean" },
});

type RollCtx = Ctx<typeof rollArgs>;

type RollOptions = {
  changelog: boolean;
  commit: boolean;
  createRelease: boolean;
  dryRun: boolean;
  npm: boolean;
  push: boolean;
  tags: boolean;
};

type PublishOnlyOptions = { createRelease: boolean; dryRun: boolean; npm: boolean; tags: boolean };

export class RollCommand extends BaseCommand {
  name = "roll";
  description = "Execute a release from pending stones";
  args = rollArgs;

  async execute(ctx: RollCtx) {
    if (ctx.args.publishOnly) {
      await this.executePublishOnly(ctx);
      return;
    }

    const options = this.resolveOptions(ctx);

    const manager = new StoneManager(ctx.config);
    const stones = await manager.list();

    if (stones.length === 0) {
      throw new Exit("No pending stones found", `Create a stone with ${color.green(`${CLI_BIN} version`)} first`);
    }

    const { packages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });

    const mergedStone = Stone.mergeAll(stones);
    const updatedPackages = Package.applyStone(mergedStone, packages);

    if (updatedPackages.length === 0) {
      throw new Exit("No packages to update", "Stones don't reference any known packages");
    }

    if (ctx.args.preview) {
      await this.previewChangelogs(ctx, stones, updatedPackages);
      return;
    }

    this.printPreview(mergedStone, updatedPackages, options);

    if (!options.dryRun && !ctx.args.yes && ctx.interactive) {
      const confirmed = await confirm({ initialValue: true, message: "Proceed with release?" });
      if (!confirmed) return;
    }

    if (options.dryRun) {
      log.info(color.yellow("Dry run complete - no changes made"));
      return;
    }

    await this.executeRelease(ctx, mergedStone, updatedPackages, stones, options);
  }

  private async previewChangelogs(ctx: RollCtx, stones: Stone[], packages: Package[]) {
    const changelogConfig = ctx.config.get("changelog");
    const generator = new ChangelogGenerator(changelogConfig);

    const s = spinner();
    s.start("Generating changelog preview...");
    await generator.generate(stones, packages);
    s.stop("Changelog preview generated");

    const fileList = packages.map((pkg) => color.dim(`  ${pkg.name}/CHANGELOG.md`)).join("\n");
    log.info(`\nPreview files created:\n${fileList}`);

    if (changelogConfig.root) {
      log.info(color.dim("  CHANGELOG.md (root)"));
    }

    log.info("");

    const shouldRevert = await confirm({ initialValue: true, message: "Revert changes?" });

    if (shouldRevert) {
      await generator.rollback();
      log.info(color.dim("Changes reverted"));
    } else {
      log.info(color.yellow("Changes kept"));
    }
  }

  private resolveOptions(ctx: RollCtx): RollOptions {
    const release = ctx.config.get("release");
    const changelog = ctx.config.get("changelog");
    const commit = !ctx.args.noCommit;

    return {
      changelog: ctx.args.changelog ?? changelog.generate,
      commit,
      createRelease: commit ? (ctx.args.createRelease ?? release.createRelease) : false,
      dryRun: ctx.args.dryRun,
      npm: ctx.args.npm ?? release.npm,
      push: commit ? (ctx.args.push ?? release.push) : false,
      tags: commit ? (ctx.args.tags ?? release.tags) : false,
    };
  }

  private printPreview(stone: Stone, packages: Package[], options: RollOptions) {
    const lines: string[] = [];

    if (options.dryRun) {
      lines.push(color.bold(color.yellow("[dry-run]")));
    }

    lines.push(`${color.bold("Release:")} ${stone.message}`);
    if (stone.tag) lines.push(`${color.dim("Tag:")} ${stone.tag}`);
    lines.push("");

    lines.push(color.bold("Packages:"));
    for (const pkg of packages) {
      lines.push(`  ${pkg.label}`);
    }

    lines.push("");
    lines.push(color.dim(`Changelog: ${options.changelog ? "yes" : "no"}`));
    lines.push(color.dim(`Git tags: ${options.tags ? "yes" : "no"}`));
    lines.push(color.dim(`NPM publish: ${options.npm ? "yes" : "no"}`));
    lines.push(color.dim(`Push to remote: ${options.push ? "yes" : "no"}`));
    lines.push(color.dim(`Create release: ${options.createRelease ? "yes" : "no"}`));

    log.step(lines.join("\n"));
  }

  private async executeRelease(
    ctx: RollCtx,
    stone: Stone,
    packages: Package[],
    originalStones: Stone[],
    options: RollOptions,
  ) {
    const orchestrator = new ReleaseOrchestrator(ctx.config, options);
    await orchestrator.preflight(packages);

    const s = spinner();

    try {
      s.start("Updating package versions...");
      await orchestrator.updatePackageVersions(packages);
      s.stop("Package versions updated");

      if (options.changelog) {
        s.start("Generating changelogs...");
        await orchestrator.generateChangelogs(originalStones, packages);
        s.stop("Changelogs generated");
      }

      await this.deleteStones(ctx, originalStones);

      if (options.commit) {
        s.start("Creating release commit...");
        await orchestrator.createCommit(stone, packages);
        s.stop("Release commit created");
      }

      ctx.config.set("lastStone", { commit: await this.getCurrentCommit(), date: new Date().toISOString() });

      if (options.tags) {
        s.start("Creating git tags...");
        await orchestrator.createGitTags(packages);
        s.stop("Git tags created");
      }

      if (options.npm) {
        s.start("Publishing to NPM...");
        await orchestrator.publishToNpm(packages);
        s.stop("Published to NPM");
      }

      if (options.push) {
        s.start("Pushing to remote...");
        await orchestrator.pushToRemote();
        s.stop("Pushed to remote");
      }

      if (options.createRelease) {
        s.start("Creating release...");
        await orchestrator.createGitRelease(originalStones, packages);
        s.stop("Release created");
      }

      note(
        `Released ${color.bold(String(packages.length))} package(s)\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to verify`,
        color.green("Release complete"),
      );
    } catch (error) {
      s.stop("Release failed, rolling back...");
      try {
        await orchestrator.rollback();
      } finally {
        await this.restoreStones(ctx, originalStones);
      }
      throw error;
    }
  }

  private async deleteStones(ctx: RollCtx, stones: Stone[]) {
    const manager = new StoneManager(ctx.config);

    for (const stone of stones) {
      await manager.delete(stone.id);
    }
  }

  private async restoreStones(ctx: RollCtx, stones: Stone[]) {
    const manager = new StoneManager(ctx.config);

    for (const stone of stones) {
      await manager.save(stone);
    }
  }

  private async getCurrentCommit(): Promise<string> {
    try {
      const result = await Bun.$`git rev-parse HEAD`.quiet();
      return result.stdout.toString().trim();
    } catch {
      return "";
    }
  }

  private async executePublishOnly(ctx: RollCtx) {
    const currentRelease = ctx.config.get("currentRelease");

    if (!currentRelease) {
      throw new Exit("No currentRelease found in config", "Run `sis actions release-pr` first to prepare a release");
    }

    const packageEntries = Object.entries(currentRelease.packages);
    if (packageEntries.length === 0) {
      throw new Exit("No packages in currentRelease", "The release config appears to be empty");
    }

    const { packages: allPackages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });
    const packagesToPublish: Package[] = [];

    for (const [name, { oldVersion, newVersion }] of packageEntries) {
      const pkg = allPackages.get(name);
      if (pkg) {
        packagesToPublish.push(pkg.withVersions(oldVersion, newVersion));
      }
    }

    if (packagesToPublish.length === 0) {
      throw new Exit("No matching packages found", "Packages in currentRelease don't exist in workspace");
    }

    log.info(color.bold("Publish-only mode"));
    log.info(color.dim(`Timestamp: ${currentRelease.timestamp}`));
    log.info(color.dim(`Stones: ${currentRelease.stoneIds.join(", ")}`));
    log.info("");

    log.info(color.bold("Packages to publish:"));
    for (const pkg of packagesToPublish) {
      log.info(`  ${pkg.name}@${pkg.newVersion ?? pkg.version}`);
    }
    log.info("");

    const release = ctx.config.get("release");
    const options: PublishOnlyOptions = {
      createRelease: ctx.args.createRelease ?? release.createRelease,
      dryRun: ctx.args.dryRun,
      npm: ctx.args.npm ?? release.npm,
      tags: ctx.args.tags ?? release.tags,
    };

    if (options.dryRun) {
      log.info(color.yellow("[dry-run] Would publish packages"));
      return;
    }

    if (!ctx.args.yes && ctx.interactive) {
      const confirmed = await confirm({ initialValue: true, message: "Proceed with publishing?" });
      if (!confirmed) return;
    }

    await this.executePublish(ctx, packagesToPublish, currentRelease, options);
  }

  private async executePublish(
    ctx: RollCtx,
    packages: Package[],
    currentRelease: { stoneIds: string[]; timestamp: string },
    options: PublishOnlyOptions,
  ) {
    const orchestrator = new ReleaseOrchestrator(ctx.config, {
      changelog: false,
      createRelease: options.createRelease,
      dryRun: options.dryRun,
      npm: options.npm,
      push: false,
      tags: options.tags,
    });
    const s = spinner();

    try {
      if (options.tags) {
        s.start("Creating and pushing git tags...");
        await orchestrator.createGitTags(packages);
        await orchestrator.pushTags();
        s.stop("Git tags pushed");
      }

      if (options.npm) {
        s.start("Publishing to NPM...");
        await orchestrator.publishToNpm(packages);
        s.stop("Published to NPM");
      }

      if (options.createRelease) {
        s.start("Creating release...");
        const manager = new StoneManager(ctx.config);
        const stones = await manager.getReleasedStones(currentRelease.timestamp);
        const releaseStones = stones.length > 0 ? stones : [this.createFallbackStone(packages)];
        await orchestrator.createGitRelease(releaseStones, packages);
        s.stop("Release created");
      }

      ctx.config.set("currentRelease", undefined);
      ctx.config.set("lastStone", { commit: await this.getCurrentCommit(), date: new Date().toISOString() });

      note(
        `Published ${color.bold(String(packages.length))} package(s)\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to verify`,
        color.green("Publish complete"),
      );
    } catch (error) {
      s.stop("Publish failed");
      throw error;
    }
  }

  private createFallbackStone(packages: Package[]): Stone {
    const message = `Release ${packages.map((p) => `${p.name}@${p.version}`).join(", ")}`;
    return Stone.create({ message }, 0);
  }
}
