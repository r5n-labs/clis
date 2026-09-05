import { args, color, log, note } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import type { Package, Stone } from "../domain";
import { BUMP_COLORS, BUMP_EMOJI } from "../domain";
import { dependentsOptions, isIgnoredPackage, predictStoneVersions, StoneManager, WorkspaceScanner } from "../services";
import type { DependencyKind } from "../types";

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
  invalid?: string;
  packages: { name: string; version: string; bump: string; newVersion: string }[];
};

type CheckData = {
  root: Package | undefined;
  packages: Map<string, Package>;
  packageNames: readonly string[];
  stones: Stone[];
  ignore: readonly string[];
  kinds: readonly DependencyKind[];
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
    const ignore = ctx.config.get("ignore") ?? [];
    const scan = await WorkspaceScanner.scan({ single: isSingle });
    const packages = scan.packages;
    const packageNames = scan.packageNames.filter((name) => !isIgnoredPackage(name, ignore));

    const rootResult = isSingle ? null : await WorkspaceScanner.scan({ single: true });
    const root = rootResult?.packages.values().next().value ?? packages.values().next().value;

    const manager = new StoneManager(ctx.config);
    const stones = await manager.list();

    return {
      config: ctx.args.config ? ctx.config.getAll() : undefined,
      ignore,
      kinds: dependentsOptions(ctx.config).kinds,
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
      stones: data.stones.map((stone) => this.stoneToJson(stone, data)),
    };

    console.log(JSON.stringify(output, null, 2));
  }

  private stoneToJson(stone: Stone, data: CheckData): JsonStone {
    const prediction = predictStoneVersions(stone, data.packages, data.ignore, data.kinds);

    if (prediction.kind === "invalid") {
      return { id: stone.id, invalid: prediction.message, message: stone.message, packages: [], tag: stone.tag };
    }

    return { id: stone.id, message: stone.message, packages: prediction.packages, tag: stone.tag };
  }

  private printFormatted(data: CheckData) {
    this.printRootInfo(data.root);
    this.printPackages(data);

    if (data.stones.length > 0) {
      this.printStones(data);
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

  private printStones(data: CheckData) {
    const allStones = data.stones.map((stone) => this.formatStone(stone, data)).join("\n\n");
    log.step(`${color.bold(color.green("Stones:"))}\n\n${allStones}`);
  }

  private formatStone(stone: Stone, data: CheckData): string {
    const lines: string[] = [];

    lines.push(`${color.bold("Stone:")} ${color.cyan(stone.id)}`);
    if (stone.tag) lines.push(`${color.dim("Tag:")} ${stone.tag}`);
    lines.push(`${color.dim("Message:")} ${stone.message}`);
    lines.push(`${color.bold("Packages:")}`);

    const prediction = predictStoneVersions(stone, data.packages, data.ignore, data.kinds);

    if (prediction.kind === "invalid") {
      lines.push(`  ${color.yellow(`invalid: ${prediction.message}`)}`);
      return lines.join("\n");
    }

    for (const pkg of prediction.packages) {
      const colorFn = BUMP_COLORS[pkg.bump];
      const emoji = BUMP_EMOJI[pkg.bump];

      lines.push(`  ${emoji} ${color.cyan(pkg.name)}@${colorFn(pkg.newVersion)} ${color.dim(`(${pkg.bump})`)}`);
    }

    return lines.join("\n");
  }
}
