import { args, color, log, note } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import type { Package, Stone } from "../domain";
import { BUMP_COLORS, BUMP_EMOJI, BUMP_ORDER } from "../domain";
import { isIgnoredPackage, StoneManager, VersionCalculator, WorkspaceScanner } from "../services";

const checkArgs = args({
  config: { alias: "c", default: false, description: "Include config in output", type: "boolean" },
  json: { alias: "j", default: false, description: "Output as JSON", type: "boolean" },
});

type CheckCtx = Ctx<typeof checkArgs>;

type JsonOutput = {
  config?: object;
  root: { name: string; version: string };
  packages: { name: string; version: string }[];
  stones: JsonStone[];
};

type JsonStone = {
  id: string;
  message: string;
  tag?: string;
  packages: { name: string; version: string; bump: string; newVersion: string }[];
};

type CheckData = {
  root: Package | undefined;
  packages: Map<string, Package>;
  packageNames: readonly string[];
  stones: Stone[];
  ignore: readonly string[];
  config?: object;
};

export class CheckCommand extends BaseCommand {
  name = "check";
  description = "Show workspace packages and pending stones";
  args = checkArgs;

  async execute(ctx: CheckCtx) {
    const data = await this.gatherData(ctx);

    if (ctx.args.json) {
      this.printJson(data);
    } else {
      this.printFormatted(data);
    }
  }

  private async gatherData(ctx: CheckCtx): Promise<CheckData> {
    const isSingle = ctx.config.get("single");
    const { packages, packageNames } = await WorkspaceScanner.scan({ single: isSingle });

    const rootResult = isSingle ? null : await WorkspaceScanner.scan({ single: true });
    const root = rootResult?.packages.values().next().value ?? packages.values().next().value;

    const manager = new StoneManager(ctx.config);
    const stones = await manager.list();

    return {
      config: ctx.args.config ? ctx.config.getAll() : undefined,
      ignore: ctx.config.get("ignore") ?? [],
      packageNames,
      packages,
      root,
      stones,
    };
  }

  private printJson(data: CheckData) {
    const output: JsonOutput = {
      config: data.config,
      packages: data.packageNames.map((name) => ({ name, version: data.packages.get(name)?.version ?? "0.0.0" })),
      root: { name: data.root?.name ?? "", version: data.root?.version ?? "0.0.0" },
      stones: data.stones.map((stone) => this.stoneToJson(stone, data.packages, data.ignore)),
    };

    console.log(JSON.stringify(output, null, 2));
  }

  private stoneToJson(stone: Stone, packages: Map<string, Package>, ignore: readonly string[]): JsonStone {
    const stonePkgs: JsonStone["packages"] = [];

    for (const bump of BUMP_ORDER) {
      for (const name of stone.getPackages(bump)) {
        if (isIgnoredPackage(name, ignore)) continue;
        const pkg = packages.get(name);
        const version = pkg?.version ?? "0.0.0";
        stonePkgs.push({ bump, name, newVersion: VersionCalculator.bump(version, bump, stone.tag), version });
      }
    }

    return { id: stone.id, message: stone.message, packages: stonePkgs, tag: stone.tag };
  }

  private printFormatted(data: CheckData) {
    this.printRootInfo(data.root);
    this.printPackages(data);

    if (data.stones.length > 0) {
      this.printStones(data.stones, data.packages, data.ignore);
    }

    if (data.config) {
      this.printConfig(data.config);
    }

    note(color.green("Sisyphus check complete."));
  }

  private printConfig(config: object) {
    const configJson = color.dim(JSON.stringify(config, null, 2));
    log.step(`${color.bold(color.green("Config:"))}\n${configJson}`);
  }

  private printRootInfo(root: Package | undefined) {
    if (!root) return;

    const version = root.version ? color.dim(`@${root.version}`) : "";
    log.step(`${color.bold(color.green("Root package:"))} ${color.cyan(root.name)}${version}`);
  }

  private printPackages(data: CheckData) {
    const lines = [`${color.bold(color.green("Packages:"))}`];

    for (const name of data.packageNames) {
      const pkg = data.packages.get(name);
      const version = pkg?.version ? color.dim(`@${pkg.version}`) : "";
      lines.push(` ${color.dim("•")} ${color.cyan(name)}${version}`);
    }

    log.step(lines.join("\n"));
  }

  private printStones(stones: Stone[], packages: Map<string, Package>, ignore: readonly string[]) {
    const allStones = stones.map((stone) => this.formatStone(stone, packages, ignore)).join("\n\n");
    log.step(`${color.bold(color.green("Stones:"))}\n\n${allStones}`);
  }

  private formatStone(stone: Stone, packages: Map<string, Package>, ignore: readonly string[]): string {
    const lines: string[] = [];

    lines.push(`${color.bold("Stone:")} ${color.cyan(stone.id)}`);
    if (stone.tag) lines.push(`${color.dim("Tag:")} ${stone.tag}`);
    lines.push(`${color.dim("Message:")} ${stone.message}`);
    lines.push(`${color.bold("Packages:")}`);

    for (const bump of BUMP_ORDER) {
      const pkgNames = stone.getPackages(bump);
      if (pkgNames.length === 0) continue;

      for (const name of pkgNames) {
        if (isIgnoredPackage(name, ignore)) continue;
        const pkg = packages.get(name);
        const version = pkg?.version ?? "0.0.0";
        const newVersion = VersionCalculator.bump(version, bump, stone.tag);
        const colorFn = BUMP_COLORS[bump];
        const emoji = BUMP_EMOJI[bump];

        lines.push(`  ${emoji} ${color.cyan(name)}@${colorFn(newVersion)} ${color.dim(`(${bump})`)}`);
      }
    }

    return lines.join("\n");
  }
}
