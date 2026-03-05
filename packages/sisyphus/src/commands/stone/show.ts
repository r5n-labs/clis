import { args, color, log, positionals } from "@r5n/cli-core";
import type { Ctx } from "../../base-command";
import { BUMP_COLORS, BumpType, type Stone } from "../../domain";
import { StoneManager } from "../../services";
import { StoneBaseCommand } from "./base";

const SEPARATOR_LENGTH = 40;

const showPositionals = positionals({ id: { description: "Stone ID to display" } });

const showArgs = args({ json: { alias: "j", default: false, description: "Output as JSON", type: "boolean" } });

type ShowCtx = Ctx<typeof showArgs, typeof showPositionals>;

export class StoneShowCommand extends StoneBaseCommand {
  name = "show";
  description = "Show details of a specific stone";
  positionals = showPositionals;
  args = showArgs;
  prompts = true;

  async execute(ctx: ShowCtx) {
    const manager = new StoneManager(ctx.config);
    const stone = await this.resolveStone(ctx.positionals.id, manager, ctx.interactive);
    this.printStone(stone, manager, ctx.args.json);
  }

  private printStone(stone: Stone, manager: StoneManager, json: boolean) {
    if (json) {
      console.log(JSON.stringify({ path: manager.getFilePath(stone.id), ...stone.toJson() }, null, 2));
    } else {
      this.printFormatted(stone, manager);
    }
  }

  private printFormatted(stone: Stone, manager: StoneManager) {
    const lines: string[] = [];

    lines.push(color.bold(`Stone: ${stone.id}`));
    lines.push(color.dim(`Path: ${manager.getFilePath(stone.id)}`));
    lines.push(color.dim("-".repeat(SEPARATOR_LENGTH)));
    lines.push("");
    lines.push(`${color.dim("Message:")} ${stone.message}`);
    if (stone.tag) lines.push(`${color.dim("Tag:")} ${color.cyan(stone.tag)}`);
    if (stone.description) lines.push(`${color.dim("Description:")} ${stone.description}`);
    lines.push("");

    const bumpTypes = [
      { bump: BumpType.Major, packages: stone.major },
      { bump: BumpType.Minor, packages: stone.minor },
      { bump: BumpType.Patch, packages: stone.patch },
      { bump: BumpType.Dependency, packages: stone.dependency },
      { bump: BumpType.Snapshot, packages: stone.snapshot },
    ];

    for (const { bump, packages } of bumpTypes) {
      if (packages.length > 0) {
        const colorFn = BUMP_COLORS[bump];
        lines.push(`${colorFn(bump)}: ${packages.join(", ")}`);
      }
    }

    log.info(lines.join("\n"));
  }
}
