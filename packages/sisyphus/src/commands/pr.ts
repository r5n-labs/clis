import { args, color, confirm, Exit, log, multiselect, note, select } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN } from "../constants";
import type { CommitInfo, Package, StoneData } from "../domain";
import { BumpType, isBumpType, nonEmpty } from "../domain";
import type { PullRequestInfo } from "../services";
import { PullRequestAnalyzer, StoneManager, WorkspaceScanner } from "../services";
import { findDependencyPackages } from "../utils";

const DESCRIPTION_PREVIEW_LENGTH = 100;

const prArgs = args({
  bump: { alias: "b", description: "Explicit bump type (major/minor/patch)", type: "string" },
  dryRun: { alias: "d", default: false, description: "Preview without writing", type: "boolean" },
  message: { alias: "m", description: "Override stone message", type: "string" },
  packages: { alias: "p", description: "Filter packages (comma-separated)", type: "string" },
  url: { alias: "u", description: "PR URL", type: "string" },
  yes: { alias: "y", default: false, description: "Skip confirmations", type: "boolean" },
});

type PrCtx = Ctx<typeof prArgs>;

export class PrCommand extends BaseCommand {
  name = "pr";
  description = "Create a stone from a Pull Request";
  args = prArgs;
  prompts = true;

  async execute(ctx: PrCtx) {
    const analyzer = new PullRequestAnalyzer(ctx.config);
    const result = await analyzer.analyze(ctx.args.url);

    this.displayPrSummary(result.pr);

    if (result.packages.size === 0) {
      throw new Exit("No packages affected by this PR", "The PR only modifies root files or files outside packages");
    }

    const bumpType = await this.determineBumpType(ctx, result.suggestedBump, result.pr.labels);
    const packages = await this.determinePackages(ctx, result.packages);

    if (packages.length === 0) {
      throw new Exit("No packages selected");
    }

    const { packages: allPackages } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });

    const prLink = `[#${result.pr.number}](${result.pr.url})`;
    const message = ctx.args.message ?? `${result.pr.title} (${prLink})`;
    const description = result.pr.body || undefined;

    const stoneData = this.buildStoneData({
      allPackages,
      bump: bumpType,
      commits: result.commits,
      description,
      message,
      packages,
    });

    this.logPreview(stoneData, ctx.args.dryRun);

    if (ctx.args.dryRun) {
      return;
    }

    if (!ctx.args.yes && ctx.interactive) {
      const confirmed = await confirm({ initialValue: true, message: "Create this stone?" });
      if (!confirmed) return;
    }

    const manager = new StoneManager(ctx.config);
    const stone = await manager.create(stoneData);

    note(
      `Run ${color.green(`${CLI_BIN} roll`)} to release packages\n` +
        `or create another stone with ${color.green(`${CLI_BIN} version`)}`,
      `Stone ${color.bold(stone.id)} ${color.green("created")}`,
    );
  }

  private displayPrSummary(pr: PullRequestInfo) {
    log.info(`PR #${color.bold(String(pr.number))}: ${pr.title}`);
    log.info(`${color.dim("Author:")} ${pr.author}`);
    log.info(`${color.dim("Branch:")} ${pr.branch}`);

    if (pr.labels.length > 0) {
      log.info(`${color.dim("Labels:")} ${pr.labels.map((l) => color.cyan(l)).join(", ")}`);
    }
  }

  private async determineBumpType(ctx: PrCtx, suggested: BumpType | null, labels: string[]): Promise<BumpType> {
    if (ctx.args.bump) {
      if (!isBumpType(ctx.args.bump)) {
        throw new Exit(`Invalid bump type: ${ctx.args.bump}`, "Use major, minor, or patch");
      }
      return ctx.args.bump;
    }

    if (suggested) {
      log.info(
        `${color.dim("Detected bump:")} ${color.bold(suggested)} (from ${this.getBumpSource(suggested, labels, ctx)})`,
      );
      return suggested;
    }

    if (ctx.args.yes) {
      throw new Exit(
        "Cannot determine bump type automatically",
        "Add a label to the PR or use --bump to specify explicitly",
      );
    }

    if (!ctx.interactive) {
      throw new Exit("Cannot determine bump type", "Use --bump to specify explicitly");
    }

    return select({
      message: "What type of change is this?",
      options: [
        { label: "patch - Bug fixes, minor changes", value: BumpType.Patch },
        { label: "minor - New features (backwards compatible)", value: BumpType.Minor },
        { label: "major - Breaking changes", value: BumpType.Major },
      ],
    });
  }

  private getBumpSource(bump: BumpType, labels: string[], ctx: PrCtx): string {
    const mapping = ctx.config.get("pr").labelMapping;

    for (const label of labels) {
      const labelLower = label.toLowerCase();
      for (const [key, value] of Object.entries(mapping)) {
        if (labelLower === key.toLowerCase() && value === bump) {
          return `label: ${label}`;
        }
      }
    }

    return "title";
  }

  private async determinePackages(ctx: PrCtx, detected: Set<string>): Promise<string[]> {
    const detectedList = Array.from(detected);

    if (ctx.args.packages) {
      const requested = ctx.args.packages
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const invalid = requested.filter((p) => !detected.has(p));

      if (invalid.length > 0) {
        throw new Exit(
          `Packages not affected by this PR: ${invalid.join(", ")}`,
          `Affected packages: ${detectedList.join(", ")}`,
        );
      }

      return requested;
    }

    if (detectedList.length === 1 || ctx.args.yes || !ctx.interactive) {
      log.info(`${color.dim("Affected packages:")} ${detectedList.map((p) => color.bold(p)).join(", ")}`);
      return detectedList;
    }

    return multiselect({
      initialValues: detectedList,
      message: "Select packages to include",
      options: detectedList.map((name) => ({ label: name, value: name })),
      required: true,
    });
  }

  private buildStoneData(options: {
    allPackages: Map<string, Package>;
    bump: BumpType;
    packages: string[];
    message: string;
    description: string | undefined;
    commits: readonly CommitInfo[] | undefined;
  }): StoneData {
    const { allPackages, bump, commits, description, message, packages } = options;
    const data: StoneData = { commits, description, message };

    if (bump === BumpType.Major) data.major = packages;
    else if (bump === BumpType.Minor) data.minor = packages;
    else data.patch = packages;

    data.dependency = nonEmpty(findDependencyPackages(packages, allPackages));

    return data;
  }

  private logPreview(data: StoneData, dryRun: boolean) {
    const lines: string[] = [];

    if (dryRun) {
      lines.push(color.bold(color.yellow("[dry-run]")));
    }

    lines.push(`${color.dim("Stone:")} ${color.bold(data.message)}`);

    if (data.major?.length) lines.push(`  ${color.red("major")}: ${data.major.join(", ")}`);
    if (data.minor?.length) lines.push(`  ${color.yellow("minor")}: ${data.minor.join(", ")}`);
    if (data.patch?.length) lines.push(`  ${color.green("patch")}: ${data.patch.join(", ")}`);

    if (data.commits?.length) {
      lines.push(`  ${color.dim(`${data.commits.length} commit(s)`)}`);
    }

    if (data.description) {
      const truncated =
        data.description.length > DESCRIPTION_PREVIEW_LENGTH
          ? `${data.description.slice(0, DESCRIPTION_PREVIEW_LENGTH)}...`
          : data.description;
      lines.push(`  ${color.dim("Description:")} ${truncated}`);
    }

    log.step(lines.join("\n"));
  }
}
