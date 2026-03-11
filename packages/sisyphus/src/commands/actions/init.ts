import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { args, color, confirm, Exit, log, multiselect, note } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";

const WORKFLOWS_DIR = ".github/workflows";
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "workflows");

type WorkflowType = "create-stone" | "release-pr" | "release";

type WorkflowConfig = { name: string; description: string; filename: string };

const WORKFLOWS: Record<WorkflowType, WorkflowConfig> = {
  "create-stone": {
    description: "When a PR is merged, automatically create a stone",
    filename: "sis-create-stone.yml",
    name: "Auto-create stone from PR",
  },
  release: {
    description: "When the release PR is merged, run the release",
    filename: "sis-release.yml",
    name: "Auto-release on PR merge",
  },
  "release-pr": {
    description: "When stones are added, create or update a release PR",
    filename: "sis-release-pr.yml",
    name: "Create/update release PR",
  },
};

const initArgs = args({
  all: { alias: "a", default: false, description: "Install all workflows", type: "boolean" },
  createStone: { default: false, description: "Install create-stone workflow", type: "boolean" },
  dryRun: { alias: "d", default: false, description: "Preview without writing files", type: "boolean" },
  release: { default: false, description: "Install release workflow", type: "boolean" },
  releasePr: { default: false, description: "Install release-pr workflow", type: "boolean" },
  yes: { alias: "y", default: false, description: "Skip confirmation prompts", type: "boolean" },
});

type InitCtx = Ctx<typeof initArgs>;

export class ActionsInitCommand extends BaseCommand {
  name = "init";
  description = "Set up GitHub Actions workflows";
  args = initArgs;
  prompts = true;

  async execute(ctx: InitCtx) {
    const selected = await this.selectWorkflows(ctx);

    if (selected.length === 0) {
      log.info(color.dim("No workflows selected"));
      return;
    }

    const existing = this.findExistingWorkflows(selected);
    if (existing.length > 0 && !ctx.args.yes) {
      if (!ctx.interactive) {
        throw new Exit(`Workflows already exist: ${existing.join(", ")}`, "Use --yes to overwrite existing workflows");
      }
      log.warn(`The following workflows already exist:\n${existing.map((f) => `  ${f}`).join("\n")}`);
      const overwrite = await confirm({ initialValue: false, message: "Overwrite existing workflows?" });
      if (!overwrite) return;
    }

    if (ctx.args.dryRun) {
      await this.previewWorkflows(selected);
      return;
    }

    await this.createWorkflows(selected);

    note(
      selected.map((w) => `  ${color.green("+")} ${WORKFLOWS[w].filename}`).join("\n"),
      color.green("Workflows created"),
    );

    log.info(color.dim("\nCommit and push these files to enable the workflows."));
  }

  private async selectWorkflows(ctx: InitCtx): Promise<WorkflowType[]> {
    const fromFlags = this.getWorkflowsFromFlags(ctx);
    if (fromFlags.length > 0) return fromFlags;

    if (ctx.args.all || !ctx.interactive) {
      return Object.keys(WORKFLOWS) as WorkflowType[];
    }

    return multiselect({
      initialValues: Object.keys(WORKFLOWS) as WorkflowType[],
      message: "Select workflows to create",
      options: Object.entries(WORKFLOWS).map(([key, config]) => ({
        hint: config.description,
        label: config.name,
        value: key as WorkflowType,
      })),
      required: false,
    });
  }

  private getWorkflowsFromFlags(ctx: InitCtx): WorkflowType[] {
    const selected: WorkflowType[] = [];
    if (ctx.args.createStone) selected.push("create-stone");
    if (ctx.args.releasePr) selected.push("release-pr");
    if (ctx.args.release) selected.push("release");
    return selected;
  }

  private findExistingWorkflows(selected: WorkflowType[]): string[] {
    return selected.map((w) => WORKFLOWS[w].filename).filter((filename) => existsSync(join(WORKFLOWS_DIR, filename)));
  }

  private async readTemplate(filename: string): Promise<string> {
    return readFile(join(TEMPLATES_DIR, filename), "utf-8");
  }

  private async previewWorkflows(selected: WorkflowType[]) {
    for (const workflow of selected) {
      const config = WORKFLOWS[workflow];
      const content = await this.readTemplate(config.filename);
      log.info(`\n${color.bold(config.filename)}:`);
      log.info(color.dim(content));
    }
  }

  private async createWorkflows(selected: WorkflowType[]) {
    if (!existsSync(WORKFLOWS_DIR)) {
      await mkdir(WORKFLOWS_DIR, { recursive: true });
    }

    for (const workflow of selected) {
      const config = WORKFLOWS[workflow];
      const content = await this.readTemplate(config.filename);
      const filepath = join(WORKFLOWS_DIR, config.filename);
      await writeFile(filepath, content, "utf-8");
    }
  }
}
