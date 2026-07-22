import { args, color, confirm, Exit, log, note, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN } from "../constants";
import { Package, Stone } from "../domain";
import {
  ChangelogGenerator,
  hashReleasePlan,
  hashReleaseSource,
  ReleaseOrchestrator,
  StoneManager,
  WorkspaceScanner,
} from "../services";

const rollArgs = args({
  changelog: { alias: "c", description: "Generate changelogs", type: "boolean" },
  createRelease: { alias: "r", description: "Create a release on git provider", type: "boolean" },
  dryRun: { alias: "d", default: false, description: "Preview without making changes", type: "boolean" },
  noCommit: { default: false, description: "Skip creating release commit", type: "boolean" },
  npm: { alias: "n", description: "Publish to NPM", type: "boolean" },
  preview: { default: false, description: "Preview changelogs then prompt to delete", type: "boolean" },
  publishOnly: { default: false, description: "Publish from currentRelease (no file changes)", type: "boolean" },
  push: { alias: "p", description: "Push commits and tags to remote", type: "boolean" },
  resume: { default: false, description: "Resume an incomplete release", type: "boolean" },
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
    this.validateModeFlags(ctx);

    if (ctx.args.resume) {
      await this.executeResume(ctx);
      return;
    }

    if (ctx.args.publishOnly) {
      await this.executePublishOnly(ctx);
      return;
    }

    await ReleaseOrchestrator.assertNoActiveRelease();
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

    const options = {
      changelog: ctx.args.changelog ?? changelog.generate,
      commit,
      createRelease: commit ? (ctx.args.createRelease ?? release.createRelease) : false,
      dryRun: ctx.args.dryRun,
      npm: ctx.args.npm ?? release.npm,
      push: commit ? (ctx.args.push ?? release.push) : false,
      tags: commit ? (ctx.args.tags ?? release.tags) : false,
    };

    if (options.createRelease && (!options.tags || !options.push)) {
      throw new Exit(
        "Provider releases require both git tags and a remote push",
        "Enable --tags and --push so the provider cannot create an implicit tag",
      );
    }
    if (!options.commit && options.npm) {
      throw new Exit(
        "Npm publication requires a release commit",
        "Remove --noCommit so package artifacts are bound to committed source",
      );
    }

    return options;
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
    const previousLastStone = { ...ctx.config.get("lastStone") };
    const preReleaseHead = await this.getCurrentCommit();
    await orchestrator.preflight(packages, originalStones);

    const s = spinner();

    try {
      await orchestrator.initializeExternalRelease(packages, originalStones, false);

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
        ctx.config.set("lastStone", { commit: preReleaseHead, date: new Date().toISOString() });
        await orchestrator.createCommit(stone, packages, originalStones);
        s.stop("Release commit created");
      }

      if (options.tags) {
        s.start("Creating git tags...");
        await orchestrator.createGitTags(packages);
        s.stop("Git tags created");
      }

      await orchestrator.finalizeExternalRelease(packages, originalStones);

      if (options.npm) {
        s.start("Preparing NPM packages...");
        await orchestrator.prepareNpmPublish(packages);
        s.stop("NPM packages prepared");
      }

      await orchestrator.markExternalReleaseReady();

      if (options.push) {
        s.start("Pushing to remote...");
        await orchestrator.pushToRemote();
        s.stop("Pushed to remote");
      }

      if (options.npm) {
        s.start("Publishing to NPM...");
        await orchestrator.publishToNpm(packages);
        s.stop("Published to NPM");
      }

      if (options.createRelease) {
        s.start("Creating release...");
        await orchestrator.createGitRelease(originalStones, packages);
        s.stop("Release created");
      }

      await orchestrator.completeRelease();

      note(
        `Released ${color.bold(String(packages.length))} package(s)\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to verify`,
        color.green("Release complete"),
      );
    } catch (error) {
      if (orchestrator.hasCrossedIrreversibleBoundary()) {
        s.stop("Release incomplete, local state preserved");
        throw orchestrator.createIncompleteReleaseError(error);
      }

      s.stop("Release failed, rolling back...");
      try {
        await orchestrator.rollback(false);
      } finally {
        ctx.config.set("lastStone", previousLastStone);
        await this.restoreStones(ctx, originalStones);
      }
      await orchestrator.removeReleaseLedger();
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

  private validateModeFlags(ctx: RollCtx) {
    if (ctx.args.resume) {
      const incompatibleFlags = [
        ctx.args.changelog !== undefined ? "--changelog" : undefined,
        ctx.args.createRelease !== undefined ? "--createRelease" : undefined,
        ctx.args.dryRun ? "--dryRun" : undefined,
        ctx.args.noCommit ? "--noCommit" : undefined,
        ctx.args.npm !== undefined ? "--npm" : undefined,
        ctx.args.preview ? "--preview" : undefined,
        ctx.args.publishOnly ? "--publishOnly" : undefined,
        ctx.args.push !== undefined ? "--push" : undefined,
        ctx.args.tags !== undefined ? "--tags" : undefined,
      ].filter((flag): flag is string => flag !== undefined);

      if (incompatibleFlags.length > 0) {
        throw new Exit(
          `--resume cannot be combined with ${incompatibleFlags.join(", ")}`,
          "Resume uses the operation settings recorded in the active release ledger",
        );
      }
      return;
    }

    if (!ctx.args.publishOnly) return;

    const incompatibleFlags = [
      ctx.args.changelog !== undefined ? "--changelog" : undefined,
      ctx.args.noCommit ? "--noCommit" : undefined,
      ctx.args.preview ? "--preview" : undefined,
      ctx.args.push !== undefined ? "--push" : undefined,
    ].filter((flag): flag is string => flag !== undefined);

    if (incompatibleFlags.length > 0) {
      throw new Exit(
        `--publishOnly cannot be combined with ${incompatibleFlags.join(", ")}`,
        "Publish-only supports --createRelease, --dryRun, --npm, --tags, and --yes",
      );
    }
  }

  private async executePublishOnly(ctx: RollCtx) {
    await ReleaseOrchestrator.assertNoActiveRelease();
    const currentRelease = ctx.config.get("currentRelease");

    if (!currentRelease) {
      throw new Exit("No currentRelease found in config", "Run `sis actions release-pr` first to prepare a release");
    }

    const sourceHash = await hashReleaseSource(ctx.config.get("sisyphusDir"));
    if (sourceHash !== currentRelease.sourceHash) {
      throw new Exit(
        "Current checkout does not match the prepared release source",
        "Recreate the release PR before publishing",
      );
    }

    const manager = new StoneManager(ctx.config);
    const releaseStones = await manager.getReleasedStones(currentRelease.timestamp, currentRelease.stoneIds);
    if (releaseStones.length === 0) {
      throw new Exit("No archived stones found for currentRelease", "Recreate the release PR before publishing");
    }
    const planHash = hashReleasePlan(
      {
        packages: currentRelease.packages,
        sourceHash: currentRelease.sourceHash,
        stoneIds: currentRelease.stoneIds,
        timestamp: currentRelease.timestamp,
      },
      releaseStones.map((stone) => stone.toJson()),
    );
    if (planHash !== currentRelease.planHash) {
      throw new Exit("Prepared release plan has changed", "Recreate the release PR before publishing");
    }

    const packageEntries = Object.entries(currentRelease.packages);
    if (packageEntries.length === 0) {
      throw new Exit("No packages in currentRelease", "The release config appears to be empty");
    }

    const { packages: allPackages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });
    const packagesToPublish: Package[] = [];

    for (const [name, { oldVersion, newVersion }] of packageEntries) {
      const pkg = allPackages.get(name);
      if (!pkg) {
        throw new Exit(`Package ${name} from currentRelease is missing from the workspace`);
      }
      if (pkg.version !== newVersion) {
        throw new Exit(
          `Package ${name} is at ${pkg.version}, but currentRelease expects ${newVersion}`,
          "Check out the exact release commit before publishing",
        );
      }
      packagesToPublish.push(pkg.withVersions(oldVersion, newVersion));
    }
    this.validateArchivedPackagePlan(releaseStones, currentRelease.packages);

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

    if (options.createRelease && !options.tags) {
      throw new Exit(
        "Provider releases require pushed git tags",
        "Enable --tags so the provider cannot create an implicit tag",
      );
    }

    if (options.dryRun) {
      log.info(color.yellow("[dry-run] Would publish packages"));
      return;
    }

    if (!ctx.args.yes && ctx.interactive) {
      const confirmed = await confirm({ initialValue: true, message: "Proceed with publishing?" });
      if (!confirmed) return;
    }

    await this.executePublish(ctx, packagesToPublish, releaseStones, options);
  }

  private async executePublish(ctx: RollCtx, packages: Package[], releaseStones: Stone[], options: PublishOnlyOptions) {
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
      await orchestrator.initializeExternalRelease(packages, releaseStones, true);

      if (options.tags) {
        s.start("Creating git tags...");
        await orchestrator.createGitTags(packages);
        s.stop("Git tags created");
      }

      await orchestrator.finalizeExternalRelease(packages, releaseStones);

      if (options.npm) {
        s.start("Preparing NPM packages...");
        await orchestrator.prepareNpmPublish(packages);
        s.stop("NPM packages prepared");
      }

      await orchestrator.markExternalReleaseReady();

      if (options.tags) {
        s.start("Pushing git tags...");
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
        await orchestrator.createGitRelease(releaseStones, packages);
        s.stop("Release created");
      }

      await orchestrator.completeRelease();

      note(
        `Published ${color.bold(String(packages.length))} package(s)\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to verify`,
        color.green("Publish complete"),
      );
    } catch (error) {
      if (orchestrator.hasCrossedIrreversibleBoundary()) {
        s.stop("Publish incomplete, local state preserved");
        throw orchestrator.createIncompleteReleaseError(error);
      }

      s.stop("Publish failed");
      await orchestrator.rollback();
      throw error;
    }
  }

  private async executeResume(ctx: RollCtx) {
    const { packages } = await ReleaseOrchestrator.resume(ctx.config);
    note(
      `Released ${color.bold(String(packages.length))} package(s)\n` +
        `Run ${color.green(`${CLI_BIN} check`)} to verify`,
      color.green("Release resumed"),
    );
  }

  private validateArchivedPackagePlan(
    stones: Stone[],
    releases: Record<string, { oldVersion: string; newVersion: string }>,
  ) {
    const mergedStone = Stone.mergeAll(stones);
    const releaseNames = Object.keys(releases).sort();
    const stoneNames = [...new Set(mergedStone.allPackages)].sort();
    if (JSON.stringify(releaseNames) !== JSON.stringify(stoneNames)) {
      throw new Exit(
        "Archived stones do not match currentRelease packages",
        "Recreate the release PR before publishing",
      );
    }

    const packages = new Map(
      Object.entries(releases).map(([name, release]) => [
        name,
        new Package({ file: `${name}/package.json`, name, version: release.oldVersion }),
      ]),
    );
    const expected = Package.applyStone(mergedStone, packages);
    for (const pkg of expected) {
      if (pkg.newVersion !== releases[pkg.name]?.newVersion) {
        throw new Exit(
          `Archived stones do not produce ${pkg.name}@${releases[pkg.name]?.newVersion ?? "missing"}`,
          "Recreate the release PR before publishing",
        );
      }
    }
  }
}
