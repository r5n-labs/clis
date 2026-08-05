import { args, color, confirm, Exit, log, multiselect, note, positionals, text } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN } from "../constants";
import { BUMP_COLORS, BumpType, nonEmpty, Package, Stone, type StoneData } from "../domain";
import {
  CommitAnalyzer,
  collectDependents,
  dependentsOptions,
  isIgnoredPackage,
  StoneManager,
  WorkspaceScanner,
} from "../services";

const PRERELEASE_TAG_PATTERN = /^[A-Za-z][0-9A-Za-z]*$/;

const versionPositionals = positionals({
  message: { description: "Stone message (commit message)" },
  description: { description: "Stone description (optional details)" },
});

const versionArgs = args({
  all: { alias: "a", default: false, description: "Select all (filtered) packages without prompting", type: "boolean" },
  bump: { alias: "b", description: "Bump type applied to all selected packages (major|minor|patch)", type: "string" },
  dryRun: { alias: "d", default: false, description: "Preview without writing files", type: "boolean" },
  filter: { alias: "f", description: "Filter packages by name", type: "string" },
  fromCommits: { default: false, description: "Generate stones from conventional commits", type: "boolean" },
  major: { alias: "M", description: "Packages for major bump (comma-separated)", type: "string" },
  message: { description: "Stone message (skips the message prompt)", type: "string" },
  minor: { alias: "m", description: "Packages for minor bump (comma-separated)", type: "string" },
  patch: { alias: "p", description: "Packages for patch bump (comma-separated)", type: "string" },
  tag: { alias: "t", description: "Prerelease tag (e.g. beta, alpha)", type: "string" },
  yes: { alias: "y", default: false, description: "Skip confirmation prompts", type: "boolean" },
});

type VersionCtx = Ctx<typeof versionArgs, typeof versionPositionals>;

type PackageSelection = { major: string[]; minor: string[]; patch: string[] };

type NormalizedVersionInput = {
  bump?: string;
  description?: string;
  filter?: string;
  hasManualSelection: boolean;
  message?: string;
  packageSelection: PackageSelection;
  packageSelectionSupplied: boolean;
  tag?: string;
};

export class VersionCommand extends BaseCommand {
  name = "version";
  description = "Create a new version stone";
  positionals = versionPositionals;
  args = versionArgs;
  prompts = true;

  async execute(ctx: VersionCtx) {
    const input = this.normalizeInput(ctx);
    this.validateFromCommitsInput(ctx, input);
    if (!ctx.args.fromCommits) this.validateManualSelectionInput(ctx, input);

    if (ctx.args.fromCommits) {
      await this.executeFromCommits(ctx, input);
    } else if (this.isInteractiveSession(ctx) && !input.hasManualSelection) {
      await this.executeInteractive(ctx, input);
    } else {
      await this.executeDirect(ctx, input);
    }
  }

  private isInteractiveSession(ctx: VersionCtx): boolean {
    return ctx.interactive && process.stdout.isTTY === true;
  }

  private normalizeInput(ctx: VersionCtx): NormalizedVersionInput {
    const packageSelectionSupplied =
      ctx.args.major !== undefined || ctx.args.minor !== undefined || ctx.args.patch !== undefined;
    const packageSelection: PackageSelection = {
      major: this.parsePackageList(ctx.args.major, "--major"),
      minor: this.parsePackageList(ctx.args.minor, "--minor"),
      patch: this.parsePackageList(ctx.args.patch, "--patch"),
    };
    this.validateExclusiveBumpGroups(packageSelection);

    const positionalMessageSupplied = ctx.positionals.message !== undefined;
    const flagMessageSupplied = ctx.args.message !== undefined;
    if (positionalMessageSupplied && flagMessageSupplied) {
      throw new Exit("Message cannot be provided both positionally and with --message");
    }

    const messageSource = positionalMessageSupplied ? ctx.positionals.message : ctx.args.message;
    const bump = this.normalizeNonEmptyValue(ctx.args.bump, "--bump");
    const filter = this.normalizeNonEmptyValue(ctx.args.filter, "--filter");

    return {
      bump,
      description: ctx.positionals.description?.trim() || undefined,
      filter,
      hasManualSelection: bump !== undefined || packageSelectionSupplied || ctx.args.all,
      message: this.normalizeNonEmptyValue(messageSource, "Message"),
      packageSelection,
      packageSelectionSupplied,
      tag: this.normalizeTag(ctx.args.tag),
    };
  }

  private normalizeNonEmptyValue(value: string | undefined, label: string): string | undefined {
    if (value === undefined) return undefined;

    const normalized = value.trim();
    if (!normalized) throw new Exit(`${label} cannot be empty`);
    return normalized;
  }

  private normalizeTag(value: string | undefined): string | undefined {
    const tag = this.normalizeNonEmptyValue(value, "--tag");
    if (tag === undefined) return undefined;
    if (!PRERELEASE_TAG_PATTERN.test(tag)) {
      throw new Exit(
        "--tag must be a supported prerelease identifier",
        "Start with a letter and use only letters or numbers",
      );
    }
    return tag;
  }

  private parsePackageList(value: string | undefined, flag: string): string[] {
    if (value === undefined) return [];

    const packageNames = value.split(",").map((name) => name.trim());
    if (packageNames.some((name) => !name)) {
      throw new Exit(`${flag} must contain one or more non-empty package names`);
    }

    return [...new Set(packageNames)];
  }

  private validateExclusiveBumpGroups(selection: PackageSelection): void {
    const assignedGroups = new Map<string, keyof PackageSelection>();
    const groups: Array<[keyof PackageSelection, string[]]> = [
      ["major", selection.major],
      ["minor", selection.minor],
      ["patch", selection.patch],
    ];

    for (const [group, packageNames] of groups) {
      for (const packageName of packageNames) {
        const assignedGroup = assignedGroups.get(packageName);
        if (assignedGroup) {
          throw new Exit(`Package "${packageName}" cannot be assigned to both --${assignedGroup} and --${group}`);
        }
        assignedGroups.set(packageName, group);
      }
    }
  }

  private validateFromCommitsInput(ctx: VersionCtx, input: NormalizedVersionInput): void {
    if (!ctx.args.fromCommits) return;
    if (!input.hasManualSelection && input.message === undefined) return;

    throw new Exit("--fromCommits cannot be combined with --bump, --all, --major, --minor, --patch, or a message");
  }

  private validateManualSelectionInput(ctx: VersionCtx, input: NormalizedVersionInput): void {
    if (ctx.args.all && input.bump === undefined) {
      throw new Exit("--all requires a valid --bump", "Use --bump major, --bump minor, or --bump patch");
    }

    if (input.bump !== undefined && input.packageSelectionSupplied) {
      throw new Exit("--bump cannot be combined with --major, --minor, or --patch");
    }

    if (
      input.bump !== undefined &&
      input.bump !== BumpType.Major &&
      input.bump !== BumpType.Minor &&
      input.bump !== BumpType.Patch
    ) {
      throw new Exit(`Invalid bump type "${input.bump}"`, "Use major, minor, or patch");
    }
  }

  private async scanPackages(ctx: VersionCtx, filter: string | undefined) {
    const scan = await WorkspaceScanner.scan({ filter, single: ctx.config.get("single") });
    const ignore = ctx.config.get("ignore") ?? [];
    const packageNames = scan.packageNames.filter((name) => !isIgnoredPackage(name, ignore));

    if (packageNames.length === 0) {
      throw new Exit("No packages found matching the criteria");
    }

    return { packageNames, packages: scan.packages };
  }

  private async executeInteractive(ctx: VersionCtx, input: NormalizedVersionInput) {
    const { packages, packageNames } = await this.scanPackages(ctx, input.filter);
    const selection = await this.selectPackagesInteractive(packages, packageNames, input.tag);
    const message = input.message ?? (await this.promptMessage());
    const description = input.description ?? (await this.promptDescription());

    const stoneData = this.buildStoneData({ ctx, description, message, packages, selection, tag: input.tag });
    await this.createStone(ctx, stoneData, packages);
  }

  private async executeDirect(ctx: VersionCtx, input: NormalizedVersionInput) {
    const message = input.message ?? (this.isInteractiveSession(ctx) ? await this.promptMessage() : undefined);
    if (!message) {
      throw new Exit("Message is required", 'Pass --message "..." or a positional message');
    }

    const { packages, packageNames } = await this.scanPackages(ctx, input.filter);
    const selection = this.resolveSelection(ctx, input, packageNames);
    this.validatePackages(selection, packages, packageNames, ctx.config.get("ignore") ?? [], input.filter);

    const stoneData = this.buildStoneData({
      ctx,
      description: input.description,
      message,
      packages,
      selection,
      tag: input.tag,
    });
    await this.createStone(ctx, stoneData, packages);
  }

  private resolveSelection(
    ctx: VersionCtx,
    input: NormalizedVersionInput,
    packageNames: readonly string[],
  ): PackageSelection {
    const bump = input.bump;
    if (!bump) {
      return this.requirePackageSelection(input.packageSelection);
    }

    if (!ctx.args.all && !ctx.args.yes) {
      throw new Exit("--bump selects every (filtered) package", "Confirm the selection with --all or --yes");
    }

    const names = [...packageNames];
    if (bump === BumpType.Major) return { major: names, minor: [], patch: [] };
    if (bump === BumpType.Minor) return { major: [], minor: names, patch: [] };
    return { major: [], minor: [], patch: names };
  }

  private requirePackageSelection(selection: PackageSelection): PackageSelection {
    const hasPackages = selection.major.length > 0 || selection.minor.length > 0 || selection.patch.length > 0;
    if (!hasPackages) {
      throw new Exit(
        "At least one of --major (-M), --minor (-m), or --patch (-p) is required",
        "Or use --bump <type> with --all to select every package",
      );
    }

    return selection;
  }

  private validatePackages(
    selection: PackageSelection,
    packages: Map<string, Package>,
    allowedPackageNames: readonly string[],
    ignore: readonly string[],
    filter?: string,
  ): void {
    const allSelected = [...selection.major, ...selection.minor, ...selection.patch];
    const unknownPackages = allSelected.filter((name) => !packages.has(name));
    if (unknownPackages.length > 0) {
      throw new Exit(`Unknown packages: ${unknownPackages.join(", ")}`);
    }

    const ignoredPackages = allSelected.filter((name) => isIgnoredPackage(name, ignore));
    if (ignoredPackages.length > 0) {
      throw new Exit(
        `Packages are excluded by config.ignore: ${ignoredPackages.join(", ")}`,
        "Remove them from ignore before releasing them",
      );
    }

    const allowedPackages = new Set(allowedPackageNames);
    const filteredPackages = allSelected.filter((name) => !allowedPackages.has(name));
    if (filteredPackages.length > 0) {
      throw new Exit(`Packages do not match --filter "${filter}": ${filteredPackages.join(", ")}`);
    }
  }

  private async executeFromCommits(ctx: VersionCtx, input: NormalizedVersionInput) {
    if (!ctx.config.get("lastStone")?.commit) {
      throw new Exit(
        "No release baseline recorded",
        `Set lastStone.commit (run ${CLI_BIN} init in an existing repo, or complete one release) before using --fromCommits`,
      );
    }

    const analyzer = new CommitAnalyzer(ctx.config);
    const commitGroups = await analyzer.analyze({ filter: input.filter, single: ctx.config.get("single") });

    if (commitGroups.length === 0) {
      log.info("No conventional commits found since last release");
      return;
    }

    const { packages } = await this.scanPackages(ctx, input.filter);

    log.info(`Found ${color.bold(String(commitGroups.length))} commit group(s) to process`);

    const manager = new StoneManager(ctx.config);
    let createdCount = 0;

    for (const group of commitGroups) {
      const stoneData = CommitAnalyzer.buildStoneData(group, packages, dependentsOptions(ctx.config, input.tag));

      if (ctx.args.dryRun) {
        this.logPreview(stoneData, packages, true);
      } else {
        const stone = await manager.create(stoneData);
        createdCount++;
        log.success(`Created stone: ${color.bold(stone.id)}`);
      }
    }

    if (!ctx.args.dryRun && createdCount > 0) {
      note(
        `Created ${color.bold(String(createdCount))} stone(s) from commits.\n` +
          `Run ${color.green(`${CLI_BIN} check`)} to see what will be released.`,
        color.green("Success"),
      );
    }
  }

  private async selectPackagesInteractive(
    packages: Map<string, Package>,
    packageNames: readonly string[],
    tag?: string,
  ): Promise<PackageSelection> {
    const selected: string[] = [];
    const result: PackageSelection = { major: [], minor: [], patch: [] };

    for (const bumpType of [BumpType.Major, BumpType.Minor, BumpType.Patch]) {
      const available = packageNames.filter((name) => !selected.includes(name));
      if (available.length === 0) break;

      const choices = await this.promptPackages(bumpType, available, packages, tag);
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
    tag?: string,
  ): Promise<string[]> {
    const colorFn = BUMP_COLORS[bump];
    const options = available.map((name) => {
      const pkg = packages.get(name);
      const label = pkg ? this.safeLabel(pkg, bump, tag) : name;
      return { label, value: name };
    });

    return multiselect({ message: `Select packages for ${color.bold(colorFn(bump))} bump`, options, required: false });
  }

  private safeLabel(pkg: Package, bump: BumpType, tag?: string): string {
    try {
      return pkg.withBump(bump, tag).label;
    } catch (error) {
      if (error instanceof Exit) return pkg.name;
      throw error;
    }
  }

  private async promptMessage(): Promise<string> {
    const message = await text({
      message: "Stone message (used as commit message)",
      placeholder: "feat: add new feature",
      validate: (value) => (value?.trim() ? undefined : "Message is required"),
    });
    return message.trim();
  }

  private async promptDescription(): Promise<string | undefined> {
    const result = await text({
      message: "Description (optional, press enter to skip)",
      placeholder: "Additional details about this change...",
    });

    return result?.trim() || undefined;
  }

  private buildStoneData(opts: {
    ctx: VersionCtx;
    selection: PackageSelection;
    message: string;
    packages: Map<string, Package>;
    tag?: string;
    description?: string;
  }): StoneData {
    const { ctx, selection, message, packages, tag, description } = opts;
    const seeds = [
      ...selection.major.map((name) => ({ bump: BumpType.Major, name })),
      ...selection.minor.map((name) => ({ bump: BumpType.Minor, name })),
      ...selection.patch.map((name) => ({ bump: BumpType.Patch, name })),
    ];
    const dependencyPackages = collectDependents(seeds, packages, dependentsOptions(ctx.config, tag));

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

  private async createStone(ctx: VersionCtx, data: StoneData, packages: Map<string, Package>) {
    const manager = new StoneManager(ctx.config);

    this.logPreview(data, packages, ctx.args.dryRun);

    if (ctx.args.dryRun) {
      return;
    }

    if (!ctx.args.yes && this.isInteractiveSession(ctx)) {
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

    for (const label of this.previewLabels(data, packages)) {
      lines.push(`  ${label}`);
    }

    log.step(lines.join("\n"));
  }

  private previewLabels(data: StoneData, packages: Map<string, Package>): string[] {
    const stone = Stone.create(data);

    try {
      return Package.applyStone(stone, packages).map((pkg) => pkg.label);
    } catch (error) {
      if (error instanceof Exit) return stone.allPackages.filter((name) => packages.has(name));
      throw error;
    }
  }
}
