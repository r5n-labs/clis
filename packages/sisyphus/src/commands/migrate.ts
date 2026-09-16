import { args, color, confirm, Exit, log, note, spinner } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN } from "../constants";
import type { StoneData } from "../domain";
import { ChangesetParser, StoneManager } from "../services";
import type { ChangesetConfig, ChangesetContent, ParseResult } from "../services/ChangesetParser";

const migrateArgs = args({
  dryRun: { alias: "d", default: false, description: "Preview migration without making changes", type: "boolean" },
  yes: { alias: "y", default: false, description: "Skip confirmation prompts", type: "boolean" },
});

type MigrateCtx = Ctx<typeof migrateArgs>;

export class MigrateCommand extends BaseCommand {
  name = "migrate";
  description = "Migrate from changesets to sisyphus";
  args = migrateArgs;

  private parser = new ChangesetParser();

  async execute(ctx: MigrateCtx) {
    if (!(await this.parser.exists())) {
      throw new Exit("No .changeset directory found", "This command migrates existing changesets to sisyphus stones");
    }

    const { changesets, config } = await this.analyzeChangesets();

    this.displayPreview(changesets, config);

    if (ctx.args.dryRun) {
      note("No changes made", color.yellow("Dry run"));
      return;
    }

    const stoneData = this.collectStoneData(changesets);

    if (!ctx.args.yes && !(await this.confirmMigration(changesets.length))) return;

    const createdStones = await this.createStones(ctx, stoneData);
    await this.applyConfigMigration(ctx, config);
    this.displaySuccess(createdStones);
  }

  private async analyzeChangesets(): Promise<ParseResult> {
    const s = spinner();
    s.start("Analyzing changesets...");

    const result = await this.parser.parse();

    if (result.errors.length > 0) {
      s.error("Found issues while parsing");
      for (const error of result.errors) {
        log.warn(color.yellow(error));
      }
    }

    if (result.changesets.length === 0) {
      s.stop("No changesets found");
      throw new Exit("No changeset files to migrate");
    }

    s.stop(`Found ${color.bold(String(result.changesets.length))} changeset(s)`);
    return result;
  }

  private displayPreview(changesets: ChangesetContent[], config: ChangesetConfig | null) {
    this.displayChangesets(changesets);
    if (config) {
      this.displayConfigMapping(config);
    }
  }

  private async confirmMigration(count: number): Promise<boolean> {
    return confirm({ initialValue: true, message: `Migrate ${count} changeset(s) to stones?` });
  }

  private collectStoneData(changesets: ChangesetContent[]): StoneData[] {
    const stoneData: StoneData[] = [];
    const errors: string[] = [];

    for (const changeset of changesets) {
      try {
        stoneData.push(this.parser.toStoneData(changeset));
      } catch (error) {
        if (!(error instanceof Exit)) throw error;
        errors.push(error.message);
      }
    }

    if (errors.length > 0) {
      throw new Exit(
        `Cannot migrate changesets:\n${errors.join("\n")}`,
        "Rewrite them as major, minor, or patch before migrating; no stones were created",
      );
    }

    return stoneData;
  }

  private async createStones(ctx: MigrateCtx, stoneData: StoneData[]): Promise<string[]> {
    const s = spinner();
    s.start("Creating stones...");

    const manager = new StoneManager(ctx.config);
    const createdStones: string[] = [];

    for (const data of stoneData) {
      const stone = await manager.create(data);
      createdStones.push(stone.id);
    }

    s.stop(`Created ${color.bold(String(createdStones.length))} stone(s)`);
    return createdStones;
  }

  private async applyConfigMigration(ctx: MigrateCtx, config: ChangesetConfig | null) {
    if (!config) return;

    const s = spinner();
    s.start("Migrating config...");
    this.migrateConfig(ctx, config);
    s.stop("Config migrated");
  }

  private displaySuccess(createdStones: string[]) {
    const stonesList = createdStones.map((id) => `  ${color.dim("-")} ${id}`).join("\n");

    note(
      `${stonesList}\n\n` +
        `Run ${color.green(`${CLI_BIN} stone list`)} to view stones\n` +
        `Run ${color.green(`${CLI_BIN} preview`)} to see what will be released`,
      color.green("Migration complete"),
    );
  }

  private displayChangesets(changesets: ChangesetContent[]) {
    for (const changeset of changesets) {
      const packages = Object.entries(changeset.packages)
        .map(([pkg, bump]) => {
          const bumpColor = bump === "major" ? color.red : bump === "minor" ? color.yellow : color.green;
          return `${pkg} ${color.dim("(")}${bumpColor(bump)}${color.dim(")")}`;
        })
        .join(", ");

      const summaryPreview = changeset.summary.length > 60 ? `${changeset.summary.slice(0, 60)}...` : changeset.summary;

      log.info(
        `${color.dim(changeset.filename)}\n` +
          `  ${color.dim("Packages:")} ${packages}\n` +
          `  ${color.dim("Message:")} ${summaryPreview || color.dim("(empty)")}`,
      );
    }
  }

  private displayConfigMapping(config: ChangesetConfig) {
    type Category = "migrate" | "info" | "unsupported";

    const rules: { category: Category; check: () => boolean; format: () => string }[] = [
      {
        category: "migrate",
        check: () => (config.ignore?.length ?? 0) > 0,
        format: () => `ignore: ${config.ignore?.join(", ")}`,
      },
      {
        category: "migrate",
        check: () => config.commit === true,
        format: () => "commit: enabled (will enable commit & push)",
      },
      {
        category: "migrate",
        check: () => config.access === "public",
        format: () => "access: public (will enable npm publishing)",
      },
      { category: "migrate", check: () => config.changelog === false, format: () => "changelog: disabled" },
      {
        category: "info",
        check: () => !!config.baseBranch && config.baseBranch !== "master",
        format: () => `baseBranch: ${config.baseBranch}`,
      },
      {
        category: "info",
        check: () => !!config.updateInternalDependencies,
        format: () => `updateInternalDependencies: ${config.updateInternalDependencies}`,
      },
      {
        category: "info",
        check: () => Array.isArray(config.changelog) || typeof config.changelog === "string",
        format: () => `changelog: ${Array.isArray(config.changelog) ? config.changelog[0] : config.changelog}`,
      },
      {
        category: "info",
        check: () => Array.isArray(config.commit) || typeof config.commit === "string",
        format: () => `commit: ${Array.isArray(config.commit) ? config.commit[0] : config.commit}`,
      },
      {
        category: "unsupported",
        check: () => (config.linked?.length ?? 0) > 0,
        format: () => `linked: ${config.linked?.length} group(s)`,
      },
      {
        category: "unsupported",
        check: () => (config.fixed?.length ?? 0) > 0,
        format: () => `fixed: ${config.fixed?.length} group(s)`,
      },
    ];

    const groups: Record<Category, { title: string; color: (s: string) => string; items: string[] }> = {
      info: { color: color.blue, items: [], title: "Info (not migrated)" },
      migrate: { color: color.green, items: [], title: "Will migrate" },
      unsupported: { color: color.yellow, items: [], title: "Not yet supported" },
    };

    for (const rule of rules) {
      if (rule.check()) {
        groups[rule.category].items.push(color.dim(rule.format()));
      }
    }

    for (const group of [groups.migrate, groups.info, groups.unsupported]) {
      if (group.items.length > 0) {
        note(group.items.join("\n"), group.color(group.title));
      }
    }
  }

  private migrateConfig(ctx: MigrateCtx, changesetConfig: ChangesetConfig) {
    if (changesetConfig.ignore?.length) {
      const currentIgnore = ctx.config.get("ignore") ?? [];
      const merged = [...new Set([...currentIgnore, ...changesetConfig.ignore])];
      ctx.config.set("ignore", merged);
    }

    if (changesetConfig.commit === true) {
      const currentCommit = ctx.config.get("commit") ?? {};
      const currentRelease = ctx.config.get("release") ?? {};

      ctx.config.set("commit", { ...currentCommit, author: currentCommit.author ?? "Sisyphus" });
      ctx.config.set("release", { ...currentRelease, push: true });
    }

    if (changesetConfig.access === "public") {
      const currentRelease = ctx.config.get("release") ?? {};
      ctx.config.set("release", { ...currentRelease, npm: true });
    }

    if (changesetConfig.changelog === false) {
      const currentChangelog = ctx.config.get("changelog") ?? {};
      ctx.config.set("changelog", { ...currentChangelog, generate: false });
    }
  }
}
