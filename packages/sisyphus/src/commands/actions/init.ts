import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { args, color, confirm, Exit, log, multiselect, note } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { detectProvider } from "../../providers";
import { createCiGenerator, GitHubCiGenerator, GitLabCiGenerator, WORKFLOW_CONFIGS, type WorkflowType } from "./CiGenerator";

const PROVIDER_LABELS = { bitbucket: "Bitbucket Pipelines", github: "GitHub Actions", gitlab: "GitLab CI" };

const initArgs = args({
  all: { alias: "a", default: false, description: "Install all workflows", type: "boolean" },
  createStone: { default: false, description: "Install create-stone workflow", type: "boolean" },
  dryRun: { alias: "d", default: false, description: "Preview without writing files", type: "boolean" },
  release: { default: false, description: "Install release workflow", type: "boolean" },
  yes: { alias: "y", default: false, description: "Skip confirmation prompts", type: "boolean" },
});

type InitCtx = Ctx<typeof initArgs>;

export class ActionsInitCommand extends BaseCommand {
  name = "init";
  description = "Set up CI workflows for automated releases";
  args = initArgs;
  prompts = true;

  async execute(ctx: InitCtx) {
    const provider = await detectProvider();
    const generator = createCiGenerator(provider);

    log.info(`Detected ${color.bold(PROVIDER_LABELS[provider])} repository\n`);

    const selected = await this.selectWorkflows(ctx);

    if (selected.length === 0) {
      log.info(color.dim("No workflows selected"));
      return;
    }

    const existing = generator.getExistingFiles(selected);
    if (existing.length > 0 && !ctx.args.yes) {
      if (!ctx.interactive) {
        throw new Exit(`Workflows already exist: ${existing.join(", ")}`, "Use --yes to overwrite existing workflows");
      }
      log.warn(`The following files already exist:\n${existing.map((f) => `  ${f}`).join("\n")}`);
      const overwrite = await confirm({ initialValue: false, message: "Overwrite existing files?" });
      if (!overwrite) return;
    }

    const files = await generator.generate(selected);

    if (ctx.args.dryRun) {
      for (const file of files) {
        log.info(`\n${color.bold(file.path)}:`);
        log.info(color.dim(file.content));
      }
      return;
    }

    for (const file of files) {
      const dir = dirname(file.path);
      if (dir !== "." && !existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(file.path, file.content, "utf-8");
    }

    note(files.map((f) => `  ${color.green("+")} ${f.path}`).join("\n"), color.green("CI workflows created"));

    if (generator instanceof GitLabCiGenerator) {
      log.info(`\nAdd this to your ${color.bold(".gitlab-ci.yml")}:\n`);
      log.info(color.cyan(generator.getIncludeInstruction()));
      log.info("");
      log.info(
        `${color.yellow("Note:")} Add a ${color.bold("GITLAB_TOKEN")} CI/CD variable (Personal Access Token with ${color.bold("api")} + ${color.bold("write_repository")} scopes)`,
      );
      log.info(color.dim("Required for creating release PRs. Settings → CI/CD → Variables"));
      log.info("");
    }

    if (generator instanceof GitHubCiGenerator) {
      log.info(
        `\n${color.yellow("Note:")} Enable ${color.bold("\"Allow GitHub Actions to create and approve pull requests\"")}`,
      );
      log.info(color.dim("Settings → Actions → General → Workflow permissions"));
      log.info("");
    }

    log.info(color.dim("Commit and push these files to enable the workflows."));
  }

  private async selectWorkflows(ctx: InitCtx): Promise<WorkflowType[]> {
    const fromFlags = this.getWorkflowsFromFlags(ctx);
    if (fromFlags.length > 0) return fromFlags;

    if (!ctx.interactive) {
      throw new Exit("No workflows specified", "Use --all or specify workflows with --createStone, --release");
    }

    return multiselect({
      initialValues: Object.keys(WORKFLOW_CONFIGS) as WorkflowType[],
      message: "Select workflows to create",
      options: Object.entries(WORKFLOW_CONFIGS).map(([key, config]) => ({
        hint: config.description,
        label: config.name,
        value: key as WorkflowType,
      })),
      required: false,
    });
  }

  private getWorkflowsFromFlags(ctx: InitCtx): WorkflowType[] {
    if (ctx.args.all) return Object.keys(WORKFLOW_CONFIGS) as WorkflowType[];

    const selected: WorkflowType[] = [];
    if (ctx.args.createStone) selected.push("create-stone");
    if (ctx.args.release) selected.push("release");
    return selected;
  }
}
