import { args, color, log } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import type { Stone } from "../../domain";
import { StoneManager } from "../../services";

const listArgs = args({
  json: { alias: "j", default: false, description: "Output as JSON", type: "boolean" },
  verbose: { alias: "v", default: false, description: "Show detailed info", type: "boolean" },
});

type ListCtx = Ctx<typeof listArgs>;

export class StoneListCommand extends BaseCommand {
  name = "list";
  description = "List all pending stones";
  args = listArgs;

  async execute(ctx: ListCtx) {
    const manager = new StoneManager(ctx.config);
    const stones = await manager.list();

    if (stones.length === 0) {
      this.printEmpty(ctx.args.json);
      return;
    }

    if (ctx.args.json) {
      this.printJson(stones, manager);
    } else {
      this.printFormatted(stones, ctx.args.verbose);
    }
  }

  private printEmpty(json: boolean) {
    if (json) {
      console.log(JSON.stringify([]));
    } else {
      log.info("No pending stones found");
    }
  }

  private printJson(stones: Stone[], manager: StoneManager) {
    const output = stones.map((s) => ({ path: manager.getFilePath(s.id), ...s.toJson() }));
    console.log(JSON.stringify(output, null, 2));
  }

  private printFormatted(stones: Stone[], verbose: boolean) {
    const header = `Found ${color.bold(String(stones.length))} pending stone${stones.length > 1 ? "s" : ""}`;
    const stoneLines = stones.map((stone) => this.formatStone(stone, verbose)).join("\n\n");
    log.info(`${header}\n\n${stoneLines}`);
  }

  private formatStone(stone: Stone, verbose: boolean): string {
    const lines: string[] = [];

    lines.push(`${color.dim("-")} ${color.bold(stone.id)}`);
    lines.push(`  ${color.dim("Message:")} ${stone.message}`);

    if (stone.tag) lines.push(`  ${color.dim("Tag:")} ${color.cyan(stone.tag)}`);
    if (stone.major.length) lines.push(`  ${color.red("Major:")} ${stone.major.join(", ")}`);
    if (stone.minor.length) lines.push(`  ${color.yellow("Minor:")} ${stone.minor.join(", ")}`);
    if (stone.patch.length) lines.push(`  ${color.green("Patch:")} ${stone.patch.join(", ")}`);

    if (verbose && stone.description) {
      lines.push(`  ${color.dim("Description:")}`);
      for (const line of stone.description.split("\n")) {
        lines.push(`    ${color.dim(line)}`);
      }
    }

    return lines.join("\n");
  }
}
