import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { args, color, confirm, Exit, log, note } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN, DEFAULT_NPM_TAG } from "../constants";
import { BumpType, Package, Stone } from "../domain";
import {
  buildReleaseReport,
  ChangelogGenerator,
  excludeIgnored,
  hashReleasePlan,
  hashReleaseSource,
  orderForRelease,
  ReleaseLedger,
  type ReleaseLedgerData,
  ReleaseOrchestrator,
  type ReleaseReportInput,
  type ReleaseReportMode,
  type ReleaseReportStatus,
  resolveReleaseNpmTag,
  StoneManager,
  WorkspaceScanner,
} from "../services";
import {
  createRollReporter,
  emitReleaseReport,
  failWithReleaseReport,
  type RollReporter,
  redirectStdoutToStderr,
} from "./roll-output";

const SNAPSHOT_DATE_SUFFIX = /\d{14}$/;

type ReportContext = {
  ledger?: ReleaseLedgerData;
  mode: ReleaseReportMode;
  npmTag: string;
  packages: Package[];
  stones: Stone[];
  tagsEnabled?: boolean;
};

const rollArgs = args({
  abort: {
    default: false,
    description: "Abandon the incomplete release if nothing external has started",
    type: "boolean",
  },
  changelog: { alias: "c", description: "Generate changelogs", type: "boolean" },
  createRelease: { alias: "r", description: "Create a release on git provider", type: "boolean" },
  dryRun: { alias: "d", description: "Preview without making changes", type: "boolean" },
  json: { alias: "j", default: false, description: "Output the release result as JSON", type: "boolean" },
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

  private reportContext: ReportContext = { mode: "release", npmTag: DEFAULT_NPM_TAG, packages: [], stones: [] };
  private restoreStdout: (() => void) | undefined;

  async execute(ctx: RollCtx) {
    if (!ctx.args.json) {
      await this.run(ctx);
      return;
    }

    const restoreStdout = redirectStdoutToStderr();
    this.restoreStdout = restoreStdout;

    try {
      await this.run(ctx);
      restoreStdout();
    } catch (error) {
      this.reportContext.ledger ??= (await ReleaseLedger.loadActive().catch(() => null))?.data;
      failWithReleaseReport(this.buildReport(ctx, "failed", { error }), error, restoreStdout);
    }
  }

  private buildReport(ctx: RollCtx, status: ReleaseReportStatus, extra: Partial<ReleaseReportInput> = {}) {
    return buildReleaseReport({
      ledger: this.reportContext.ledger ?? null,
      mode: this.reportContext.mode,
      npmTag: this.reportContext.npmTag,
      packages: this.reportContext.packages,
      status,
      stones: this.reportContext.stones,
      tagsEnabled: this.reportContext.tagsEnabled ?? ctx.args.tags ?? ctx.config.get("release").tags,
      ...extra,
    });
  }

  private emit(ctx: RollCtx, status: ReleaseReportStatus, extra: Partial<ReleaseReportInput> = {}) {
    if (!ctx.args.json) return;
    emitReleaseReport(this.buildReport(ctx, status, extra), this.restoreStdout);
  }

  private async run(ctx: RollCtx) {
    this.validateModeFlags(ctx);

    if (ctx.args.abort) {
      this.reportContext.mode = "abort";
      await this.executeAbort(ctx);
      return;
    }

    if (ctx.args.resume) {
      this.reportContext.mode = "resume";
      await this.executeResume(ctx);
      return;
    }

    if (ctx.args.publishOnly) {
      this.reportContext.mode = "publish-only";
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
    const updatedPackages = this.planPackages(ctx, Package.applyStone(mergedStone, packages));

    if (updatedPackages.length === 0) {
      throw new Exit("No packages to update", "Stones don't reference any known packages");
    }

    this.reportContext = {
      mode: options.dryRun ? "dry-run" : ctx.args.preview ? "preview" : "release",
      npmTag: options.npm ? resolveReleaseNpmTag(updatedPackages, ctx.config.get("tag")) : DEFAULT_NPM_TAG,
      packages: updatedPackages,
      stones,
      tagsEnabled: options.tags,
    };

    if (ctx.args.preview) {
      await this.previewChangelogs(ctx, stones, updatedPackages);
      return;
    }

    const reporter = createRollReporter(ctx.args.json);
    this.printPreview(reporter, mergedStone, updatedPackages, options);

    if (!options.dryRun && !ctx.args.yes && !ctx.args.json && process.stdout.isTTY) {
      const confirmed = await confirm({ initialValue: true, message: "Proceed with release?" });
      if (!confirmed) return;
    }

    if (options.dryRun) {
      reporter.info(color.yellow("Dry run complete - no changes made"));
      this.emit(ctx, "planned");
      return;
    }

    await this.executeRelease(ctx, reporter, mergedStone, updatedPackages, stones, options);
  }

  private planPackages(ctx: RollCtx, packages: Package[]): Package[] {
    const warn = ctx.args.json ? () => undefined : (message: string) => log.warn(color.yellow(message));
    const { kept, skipped } = excludeIgnored(packages, ctx.config.get("ignore") ?? []);
    if (skipped.length > 0) warn(`Excluded by config.ignore: ${skipped.join(", ")}`);

    const { cycle, ordered } = orderForRelease(kept);
    if (cycle.length > 0) {
      warn(`Dependency cycle between ${cycle.join(", ")}; publish order may not satisfy every pin`);
    }

    return ordered;
  }

  private async previewChangelogs(ctx: RollCtx, stones: Stone[], packages: Package[]) {
    const changelogConfig = ctx.config.get("changelog");
    const generator = new ChangelogGenerator(changelogConfig);
    const reporter = createRollReporter(ctx.args.json);

    reporter.start("Generating changelog preview...");
    await generator.generate(stones, packages);
    reporter.stop("Changelog preview generated");

    const changelogFiles = packages.map((pkg) => join(dirname(pkg.file), changelogConfig.filename));
    if (changelogConfig.root) changelogFiles.push(changelogConfig.filename);

    reporter.info(`\nPreview files created:\n${changelogFiles.map((file) => color.dim(`  ${file}`)).join("\n")}`);
    reporter.info("");

    const shouldRevert = await this.resolvePreviewRevert(ctx, generator, reporter);

    if (shouldRevert) {
      await generator.rollback();
      reporter.info(color.dim("Changes reverted"));
    } else {
      reporter.info(color.yellow("Changes kept"));
    }

    this.emit(ctx, "previewed", { changelogFiles });
  }

  private async resolvePreviewRevert(
    ctx: RollCtx,
    generator: ChangelogGenerator,
    reporter: RollReporter,
  ): Promise<boolean> {
    if (ctx.args.json) return true;

    try {
      return await confirm({ initialValue: true, message: "Revert changes?" });
    } catch (error) {
      await generator.rollback();
      reporter.info(color.dim("Changes reverted"));
      throw error;
    }
  }

  private resolveOptions(ctx: RollCtx): RollOptions {
    const release = ctx.config.get("release");
    const changelog = ctx.config.get("changelog");
    const commit = !ctx.args.noCommit;

    if (!commit) {
      const dropped = [
        ctx.args.createRelease ? "--createRelease" : undefined,
        ctx.args.push ? "--push" : undefined,
        ctx.args.tags ? "--tags" : undefined,
      ].filter((flag): flag is string => flag !== undefined);
      if (dropped.length > 0) {
        throw new Exit(
          `--noCommit cannot be combined with ${dropped.join(", ")}`,
          "Tags, pushes, and provider releases require the release commit",
        );
      }
    }

    const options = {
      changelog: ctx.args.changelog ?? changelog.generate,
      commit,
      createRelease: commit ? (ctx.args.createRelease ?? release.createRelease) : false,
      dryRun: ctx.args.dryRun ?? false,
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

  private printPreview(reporter: RollReporter, stone: Stone, packages: Package[], options: RollOptions) {
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

    reporter.step(lines.join("\n"));
  }

  private async executeRelease(
    ctx: RollCtx,
    reporter: RollReporter,
    stone: Stone,
    packages: Package[],
    originalStones: Stone[],
    options: RollOptions,
  ) {
    const orchestrator = new ReleaseOrchestrator(ctx.config, options);
    const previousLastStone = { ...ctx.config.get("lastStone") };
    const configPath = ctx.config.path;
    const previousConfigText = (await Bun.file(configPath).exists()) ? await Bun.file(configPath).text() : null;
    const stoneManager = new StoneManager(ctx.config);
    const stoneSnapshots = new Map<string, string>();
    for (const originalStone of originalStones) {
      const stonePath = stoneManager.getFilePath(originalStone.id);
      if (await Bun.file(stonePath).exists()) {
        stoneSnapshots.set(stonePath, await Bun.file(stonePath).text());
      }
    }
    const preReleaseHead = await this.getCurrentCommit();
    await orchestrator.preflight(packages, originalStones);

    const s = reporter;

    try {
      await orchestrator.initializeExternalRelease(packages, originalStones, false);
      this.reportContext.ledger = orchestrator.getLedgerSnapshot() ?? undefined;

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
        await orchestrator.pushRelease();
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
      this.reportContext.ledger = orchestrator.getLedgerSnapshot() ?? this.reportContext.ledger;

      s.note(
        `Released ${color.bold(String(packages.length))} package(s)\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to verify`,
        color.green("Release complete"),
      );
      this.emit(ctx, "completed");
    } catch (error) {
      this.reportContext.ledger = orchestrator.getLedgerSnapshot() ?? this.reportContext.ledger;
      if (orchestrator.hasCrossedIrreversibleBoundary()) {
        s.stop("Release incomplete, local state preserved");
        throw orchestrator.createIncompleteReleaseError(error);
      }

      s.stop("Release failed, rolling back...");
      try {
        await orchestrator.rollback(false);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Release failed and rollback could not be completed; local release state was preserved",
        );
      }
      try {
        ctx.config.set("lastStone", previousLastStone);
        await this.restoreStones(ctx, originalStones);
        for (const [stonePath, stoneText] of stoneSnapshots) {
          await Bun.write(stonePath, stoneText);
        }
        if (previousConfigText === null) await rm(configPath, { force: true });
        else await Bun.write(configPath, previousConfigText);
      } catch (restorationError) {
        throw new AggregateError(
          [error, restorationError],
          "Release failed and local metadata could not be restored; local release state was preserved",
        );
      }
      try {
        await orchestrator.removeReleaseLedger();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Release failed and the recovery ledger could not be removed; remove it before the next roll",
        );
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

  private validateModeFlags(ctx: RollCtx) {
    if (ctx.args.abort) {
      const incompatibleFlags = [
        ctx.args.changelog !== undefined ? "--changelog" : undefined,
        ctx.args.createRelease !== undefined ? "--createRelease" : undefined,
        ctx.args.dryRun !== undefined ? "--dryRun" : undefined,
        ctx.args.noCommit ? "--noCommit" : undefined,
        ctx.args.npm !== undefined ? "--npm" : undefined,
        ctx.args.preview ? "--preview" : undefined,
        ctx.args.publishOnly ? "--publishOnly" : undefined,
        ctx.args.push !== undefined ? "--push" : undefined,
        ctx.args.resume ? "--resume" : undefined,
        ctx.args.tags !== undefined ? "--tags" : undefined,
      ].filter((flag): flag is string => flag !== undefined);

      if (incompatibleFlags.length > 0) {
        throw new Exit(
          `--abort cannot be combined with ${incompatibleFlags.join(", ")}`,
          "Abort only removes the recovery ledger of an incomplete release",
        );
      }
      return;
    }

    if (ctx.args.resume) {
      const incompatibleFlags = [
        ctx.args.changelog !== undefined ? "--changelog" : undefined,
        ctx.args.createRelease !== undefined ? "--createRelease" : undefined,
        ctx.args.dryRun !== undefined ? "--dryRun" : undefined,
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

    if (ctx.args.preview && ctx.args.dryRun) {
      throw new Exit(
        "--preview cannot be combined with --dryRun",
        "Preview writes changelog files and then offers to revert them",
      );
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
    const releaseStones = await manager
      .getReleasedStones(currentRelease.timestamp, currentRelease.stoneIds)
      .catch((error: unknown) => {
        throw new Exit(
          error instanceof Error ? error.message : String(error),
          "Recreate the release PR before publishing",
        );
      });
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

    const reporter = createRollReporter(ctx.args.json);
    const { cycle, ordered } = orderForRelease(packagesToPublish);
    if (cycle.length > 0) {
      reporter.warn(
        color.yellow(`Dependency cycle between ${cycle.join(", ")}; publish order may not satisfy every pin`),
      );
    }

    reporter.info(color.bold("Publish-only mode"));
    reporter.info(color.dim(`Timestamp: ${currentRelease.timestamp}`));
    reporter.info(color.dim(`Stones: ${currentRelease.stoneIds.join(", ")}`));
    reporter.info("");

    reporter.info(color.bold("Packages to publish:"));
    for (const pkg of ordered) {
      reporter.info(`  ${pkg.name}@${pkg.newVersion ?? pkg.version}`);
    }
    reporter.info("");

    const release = ctx.config.get("release");
    const options: PublishOnlyOptions = {
      createRelease: ctx.args.createRelease ?? release.createRelease,
      dryRun: ctx.args.dryRun ?? false,
      npm: ctx.args.npm ?? release.npm,
      tags: ctx.args.tags ?? release.tags,
    };

    reporter.info(
      color.dim(`Operations: npm=${options.npm} tags=${options.tags} createRelease=${options.createRelease}`),
    );

    this.reportContext = {
      mode: "publish-only",
      npmTag: options.npm ? resolveReleaseNpmTag(ordered, ctx.config.get("tag")) : DEFAULT_NPM_TAG,
      packages: ordered,
      stones: releaseStones,
      tagsEnabled: options.tags,
    };

    if (options.createRelease && !options.tags) {
      throw new Exit(
        "Provider releases require pushed git tags",
        "Enable --tags so the provider cannot create an implicit tag",
      );
    }

    if (!options.npm && !options.tags && !options.createRelease) {
      throw new Exit(
        "Nothing to publish: npm, tags, and provider release are all disabled",
        "Enable --npm, --tags, or --createRelease",
      );
    }

    if (options.dryRun) {
      reporter.info(color.yellow("[dry-run] Would publish packages"));
      this.emit(ctx, "planned");
      return;
    }

    if (!ctx.args.yes && !ctx.args.json && process.stdout.isTTY) {
      const confirmed = await confirm({ initialValue: true, message: "Proceed with publishing?" });
      if (!confirmed) return;
    }

    await this.executePublish(ctx, reporter, ordered, releaseStones, options);
  }

  private async executePublish(
    ctx: RollCtx,
    reporter: RollReporter,
    packages: Package[],
    releaseStones: Stone[],
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
    const s = reporter;
    try {
      await orchestrator.initializeExternalRelease(packages, releaseStones, true);
      this.reportContext.ledger = orchestrator.getLedgerSnapshot() ?? undefined;

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
        await orchestrator.pushRelease();
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
      this.reportContext.ledger = orchestrator.getLedgerSnapshot() ?? this.reportContext.ledger;

      s.note(
        `Published ${color.bold(String(packages.length))} package(s)\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to verify`,
        color.green("Publish complete"),
      );
      this.emit(ctx, "completed");
    } catch (error) {
      this.reportContext.ledger = orchestrator.getLedgerSnapshot() ?? this.reportContext.ledger;
      if (orchestrator.hasCrossedIrreversibleBoundary()) {
        s.stop("Publish incomplete, local state preserved");
        throw orchestrator.createIncompleteReleaseError(error);
      }

      s.stop("Publish failed");
      try {
        await orchestrator.rollback();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Publish failed and rollback could not be completed; local release state was preserved",
        );
      }
      throw error;
    }
  }

  private async executeAbort(ctx: RollCtx) {
    const ledger = await ReleaseLedger.loadActive();
    if (!ledger) throw new Exit("No incomplete release found", "Nothing to abort");
    if (ledger.hasExternalProgress()) {
      throw new Exit(
        `Release ${ledger.id} already performed external operations`,
        `Run ${CLI_BIN} roll --resume to reconcile; aborting after a push or publish is not supported`,
      );
    }

    this.reportContext = { ledger: ledger.data, mode: "abort", npmTag: DEFAULT_NPM_TAG, packages: [], stones: [] };
    await ledger.remove();

    if (!ctx.args.json) {
      log.warn("Release abandoned; version bumps, changelogs, the release commit, and local tags were kept");
    }
    this.emit(ctx, "aborted");
  }

  private async executeResume(ctx: RollCtx) {
    const { ledger, packages, stones } = await ReleaseOrchestrator.resume(ctx.config);

    this.reportContext = {
      ledger: ledger ?? undefined,
      mode: "resume",
      npmTag: ledger?.options.npmTag ?? DEFAULT_NPM_TAG,
      packages,
      stones,
      tagsEnabled: ledger?.options.tags ?? false,
    };

    if (!ctx.args.json) {
      note(
        `Released ${color.bold(String(packages.length))} package(s)\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to verify`,
        color.green("Release resumed"),
      );
    }
    this.emit(ctx, "completed");
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
      const releaseVersion = releases[pkg.name]?.newVersion;
      const expectedVersion =
        pkg.bump === BumpType.Snapshot ? pkg.newVersion?.replace(SNAPSHOT_DATE_SUFFIX, "") : pkg.newVersion;
      const actualVersion =
        pkg.bump === BumpType.Snapshot ? releaseVersion?.replace(SNAPSHOT_DATE_SUFFIX, "") : releaseVersion;
      if (expectedVersion !== actualVersion) {
        throw new Exit(
          `Archived stones do not produce ${pkg.name}@${releaseVersion ?? "missing"}`,
          "Recreate the release PR before publishing",
        );
      }
    }
  }
}
