import { args, color, confirm, Exit, log, multiselect, note, positionals, text } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN } from "../constants";
import { BUMP_COLORS, BumpType, nonEmpty, type Package, type StoneData } from "../domain";
import { CommitAnalyzer, type CommitGroup, StoneManager, WorkspaceScanner } from "../services";
import { findDependencyPackages } from "../utils";

// biome-ignore assist/source/useSortedKeys: message must come first
const versionPositionals = positionals({
  message: { description: "Stone message (commit message)" },
  description: { description: "Stone description (optional details)" },
});

// biome-ignore assist/source/useSortedKeys: cleaner order
const versionArgs = args({
  dryRun: { alias: "d", default: false, description: "Preview without writing files", type: "boolean" },
  filter: { alias: "f", description: "Filter packages by name", type: "string" },
  fromCommits: { default: false, description: "Generate stones from conventional commits", type: "boolean" },
  major: { alias: "M", description: "Packages for major bump (comma-separated)", type: "string" },
  minor: { alias: "m", description: "Packages for minor bump (comma-separated)", type: "string" },
  patch: { alias: "p", description: "Packages for patch bump (comma-separated)", type: "string" },
  tag: { alias: "t", description: "Prerelease tag (e.g. beta, alpha)", type: "string" },
  yes: { alias: "y", default: false, description: "Skip confirmation prompts", type: "boolean" },
});

type VersionCtx = Ctx<typeof versionArgs, typeof versionPositionals>;

type PackageSelection = { major: string[]; minor: string[]; patch: string[] };

export class VersionCommand extends BaseCommand {
  name = "version";
  description = "Create a new version stone";
  positionals = versionPositionals;
  args = versionArgs;
  prompts = true;

  async execute(ctx: VersionCtx) {
    if (ctx.args.fromCommits) {
      await this.executeFromCommits(ctx);
    } else if (ctx.interactive) {
      await this.executeInteractive(ctx);
    } else {
      await this.executeDirect(ctx);
    }
  }

  private async executeInteractive(ctx: VersionCtx) {
    const { packages, packageNames } = await WorkspaceScanner.scan({ single: ctx.config.get("single") });

    if (packageNames.length === 0) {
      throw new Exit("No packages found matching the criteria");
    }

    const selection = await this.selectPackagesInteractive(packages, packageNames);
    const message = await this.promptMessage();
    const description = await this.promptDescription();

    const stoneData = this.buildStoneData({ description, message, packages, selection });
    await this.createStone(ctx, stoneData, packages);
  }

  private async executeDirect(ctx: VersionCtx) {
    const selection = this.parsePackageArgs(ctx.args);

    if (!ctx.positionals.message) {
      throw new Exit("Message positional is required in non-interactive mode");
    }

    const { packages } = await WorkspaceScanner.scan({ filter: ctx.args.filter, single: ctx.config.get("single") });

    const invalidPackages = this.validatePackages(selection, packages);
    if (invalidPackages.length > 0) {
      throw new Exit(`Unknown packages: ${invalidPackages.join(", ")}`);
    }

    const stoneData = this.buildStoneData({
      description: ctx.positionals.description,
      message: ctx.positionals.message,
      packages,
      selection,
      tag: ctx.args.tag,
    });
    await this.createStone(ctx, stoneData, packages);
  }

  private parsePackageArgs(args: VersionCtx["args"]): PackageSelection {
    const parseList = (value: string | undefined) =>
      value
        ?.split(",")
        .map((p) => p.trim())
        .filter(Boolean) ?? [];

    const selection: PackageSelection = {
      major: parseList(args.major),
      minor: parseList(args.minor),
      patch: parseList(args.patch),
    };

    const hasPackages = selection.major.length > 0 || selection.minor.length > 0 || selection.patch.length > 0;
    if (!hasPackages) {
      throw new Exit("At least one of --major (-M), --minor (-m), or --patch (-p) is required");
    }

    return selection;
  }

  private validatePackages(selection: PackageSelection, packages: Map<string, Package>): string[] {
    const allSelected = [...selection.major, ...selection.minor, ...selection.patch];
    return allSelected.filter((name) => !packages.has(name));
  }

  private async executeFromCommits(ctx: VersionCtx) {
    const analyzer = new CommitAnalyzer(ctx.config);
    const commitGroups = await analyzer.analyze({ filter: ctx.args.filter, single: ctx.config.get("single") });

    if (commitGroups.length === 0) {
      log.info("No conventional commits found since last release");
      return;
    }

    const { packages } = await WorkspaceScanner.scan({ filter: ctx.args.filter, single: ctx.config.get("single") });

    log.info(`Found ${color.bold(String(commitGroups.length))} commit group(s) to process`);

    const manager = new StoneManager(ctx.config);
    let createdCount = 0;

    for (const group of commitGroups) {
      const stoneData = this.buildStoneDataFromCommitGroup(group, packages, ctx.args.tag);

      if (ctx.args.dryRun) {
        this.logDryRunStone(stoneData);
      } else {
        const stone = await manager.create(stoneData);
        createdCount++;
        log.success(`Created stone: ${color.bold(stone.id)}`);
      }
    }

    if (!ctx.args.dryRun && createdCount > 0) {
      note(
        `Created ${color.bold(String(createdCount))} stone(s) from commits.\n` +
          `Run ${color.green(`${CLI_BIN} preview`)} to see what will be released.`,
        color.green("Success"),
      );
    }
  }

  private async selectPackagesInteractive(
    packages: Map<string, Package>,
    packageNames: readonly string[],
  ): Promise<PackageSelection> {
    const selected: string[] = [];
    const result: PackageSelection = { major: [], minor: [], patch: [] };

    for (const bumpType of [BumpType.Major, BumpType.Minor, BumpType.Patch]) {
      const available = packageNames.filter((name) => !selected.includes(name));
      if (available.length === 0) break;

      const choices = await this.promptPackages(bumpType, available, packages);
      selected.push(...choices);

      if (bumpType === BumpType.Major) result.major = choices;
      else if (bumpType === BumpType.Minor) result.minor = choices;
      else result.patch = choices;
    }

    if (selected.length === 0) {
      throw new Exit("No packages selected");
    }

    return result;
  }

  private async promptPackages(
    bump: BumpType,
    available: readonly string[],
    packages: Map<string, Package>,
  ): Promise<string[]> {
    const colorFn = BUMP_COLORS[bump];
    const options = available.map((name) => {
      const pkg = packages.get(name);
      const label = pkg ? pkg.withBump(bump).label : name;
      return { label, value: name };
    });

    return multiselect({ message: `Select packages for ${color.bold(colorFn(bump))} bump`, options, required: false });
  }

  private async promptMessage(): Promise<string> {
    return text({
      message: "Stone message (used as commit message)",
      placeholder: "feat: add new feature",
      validate: (value) => (value?.trim() ? undefined : "Message is required"),
    });
  }

  private async promptDescription(): Promise<string | undefined> {
    const result = await text({
      message: "Description (optional, press enter to skip)",
      placeholder: "Additional details about this change...",
    });

    return result?.trim() || undefined;
  }

  private buildStoneData(opts: {
    selection: PackageSelection;
    message: string;
    packages: Map<string, Package>;
    tag?: string;
    description?: string;
  }): StoneData {
    const { selection, message, packages, tag, description } = opts;
    const allSelected = [...selection.major, ...selection.minor, ...selection.patch];
    const dependencyPackages = findDependencyPackages(allSelected, packages);

    return {
      dependency: nonEmpty(dependencyPackages),
      description,
      major: nonEmpty(selection.major),
      message,
      minor: nonEmpty(selection.minor),
      patch: nonEmpty(selection.patch),
      tag,
    };
  }

  private buildStoneDataFromCommitGroup(group: CommitGroup, packages: Map<string, Package>, tag?: string): StoneData {
    const pkgNames = Array.from(group.packages);
    const commits = group.commits.length > 0 ? group.commits : undefined;
    const data: StoneData = { commits, message: group.message, tag };

    if (group.bump === BumpType.Major) data.major = pkgNames;
    else if (group.bump === BumpType.Minor) data.minor = pkgNames;
    else data.patch = pkgNames;

    const deps = findDependencyPackages(pkgNames, packages);
    if (deps.length > 0) data.dependency = deps;

    return data;
  }

  private async createStone(ctx: VersionCtx, data: StoneData, packages: Map<string, Package>) {
    const manager = new StoneManager(ctx.config);

    this.logPreview(data, packages, ctx.args.dryRun);

    if (ctx.args.dryRun) {
      return;
    }

    if (!ctx.args.yes && ctx.interactive) {
      const confirmed = await confirm({ initialValue: true, message: "Create this stone?" });
      if (!confirmed) return;
    }

    const stone = await manager.create(data);

    note(
      `Run ${color.green(`${CLI_BIN} roll`)} to release packages\n` +
        `or create another stone with ${color.green(`${CLI_BIN} version`)}`,
      `Stone ${color.bold(stone.id)} ${color.green("created")}`,
    );
  }

  private logPreview(data: StoneData, packages: Map<string, Package>, dryRun: boolean) {
    const lines: string[] = [];

    if (dryRun) {
      lines.push(color.bold(color.yellow("[dry-run]")));
    }

    lines.push(`${color.dim("Stone:")} ${color.bold(data.message)}`);
    if (data.tag) lines.push(`${color.dim("Tag:")} ${data.tag}`);

    const bumpTypes = [
      { bump: BumpType.Major, names: data.major },
      { bump: BumpType.Minor, names: data.minor },
      { bump: BumpType.Patch, names: data.patch },
      { bump: BumpType.Dependency, names: data.dependency },
    ];

    for (const { bump, names } of bumpTypes) {
      if (!names?.length) continue;

      for (const name of names) {
        const pkg = packages.get(name);
        if (pkg) {
          lines.push(`  ${pkg.withBump(bump, data.tag).label}`);
        }
      }
    }

    log.step(lines.join("\n"));
  }

  private logDryRunStone(data: StoneData) {
    const lines = [color.bold(color.yellow("[dry-run]")), `Stone: ${data.message}`];

    if (data.major?.length) lines.push(`  Major: ${data.major.join(", ")}`);
    if (data.minor?.length) lines.push(`  Minor: ${data.minor.join(", ")}`);
    if (data.patch?.length) lines.push(`  Patch: ${data.patch.join(", ")}`);
    if (data.dependency?.length) lines.push(`  Dependency: ${data.dependency.join(", ")}`);
    if (data.description) lines.push(`  ${color.dim("Commits:")}\n${color.dim(data.description)}`);

    log.info(lines.join("\n"));
  }
}
