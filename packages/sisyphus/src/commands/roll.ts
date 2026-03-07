import { args, color, confirm, Exit, log, note, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN } from "../constants";
import { BUMP_ORDER, type Package, Stone } from "../domain";
import { ChangelogGenerator, ReleaseOrchestrator, StoneManager, WorkspaceScanner } from "../services";

const rollArgs = args({
  changelog: { alias: "c", description: "Generate changelogs", type: "boolean" },
  dryRun: { alias: "d", default: false, description: "Preview without making changes", type: "boolean" },
  github: { alias: "g", description: "Create GitHub releases", type: "boolean" },
  noCommit: { default: false, description: "Skip creating release commit", type: "boolean" },
  npm: { alias: "n", description: "Publish to NPM", type: "boolean" },
  preview: { default: false, description: "Preview changelogs then prompt to delete", type: "boolean" },
  push: { alias: "p", description: "Push commits and tags to remote", type: "boolean" },
  tags: { alias: "t", description: "Create git tags", type: "boolean" },
  yes: { alias: "y", default: false, description: "Skip confirmation prompts", type: "boolean" },
});

type RollCtx = Ctx<typeof rollArgs>;

type RollOptions = {
  changelog: boolean;
  commit: boolean;
  dryRun: boolean;
  github: boolean;
  npm: boolean;
  push: boolean;
  tags: boolean;
};

export class RollCommand extends BaseCommand {
  name = "roll";
  description = "Execute a release from pending stones";
  args = rollArgs;

  async execute(ctx: RollCtx) {
    const options = this.resolveOptions(ctx);

    const manager = new StoneManager(ctx.config);
    const stones = await manager.list();

    if (stones.length === 0) {
      throw new Exit("No pending stones found", `Create a stone with ${color.green(`${CLI_BIN} version`)} first`);
    }

    const { packages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });

    const mergedStone = this.mergeStones(stones);
    const updatedPackages = this.preparePackages(mergedStone, packages);

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

    return {
      changelog: ctx.args.changelog ?? changelog.generate,
      commit: !ctx.args.noCommit,
      dryRun: ctx.args.dryRun,
      github: ctx.args.github ?? release.github,
      npm: ctx.args.npm ?? release.npm,
      push: ctx.args.push ?? release.push,
      tags: ctx.args.tags ?? release.tags,
    };
  }

  private mergeStones(stones: Stone[]): Stone {
    const [first, ...rest] = stones;
    if (!first) throw new Exit("No stones to merge");
    if (rest.length === 0) return first;

    const messages = stones.map((s) => s.message).join("; ");
    return Stone.merge(stones, messages).stone;
  }

  private preparePackages(stone: Stone, packages: Map<string, Package>): Package[] {
    const updated: Package[] = [];

    for (const bump of BUMP_ORDER) {
      for (const name of stone.getPackages(bump)) {
        const pkg = packages.get(name);
        if (pkg) {
          updated.push(pkg.withBump(bump, stone.tag));
        }
      }
    }

    return updated;
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
    lines.push(color.dim(`GitHub release: ${options.github ? "yes" : "no"}`));

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

      if (options.commit) {
        s.start("Creating release commit...");
        await orchestrator.createCommit(stone, packages);
        s.stop("Release commit created");
      }

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

      if (options.github) {
        s.start("Creating GitHub release...");
        await orchestrator.createGithubRelease(stone, packages);
        s.stop("GitHub release created");
      }

      await this.cleanup(ctx, originalStones);

      note(
        `Released ${color.bold(String(packages.length))} package(s)\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to verify`,
        color.green("Release complete"),
      );
    } catch (error) {
      s.stop("Release failed, rolling back...");
      await orchestrator.rollback();
      throw error;
    }
  }

  private async cleanup(ctx: RollCtx, stones: Stone[]) {
    const manager = new StoneManager(ctx.config);

    for (const stone of stones) {
      await manager.delete(stone.id);
    }

    ctx.config.set("lastStone", { commit: await this.getCurrentCommit(), date: new Date().toISOString() });
  }

  private async getCurrentCommit(): Promise<string> {
    try {
      const result = await Bun.$`git rev-parse HEAD`.quiet();
      return result.stdout.toString().trim();
    } catch {
      return "";
    }
  }
}
