import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "../../providers";

export type WorkflowType = "create-stone" | "release";

export type WorkflowFile = { path: string; content: string };

export type WorkflowConfig = { name: string; description: string };

export const WORKFLOW_CONFIGS: Record<WorkflowType, WorkflowConfig> = {
  "create-stone": {
    description: "When a PR is merged, create stone and update release PR",
    name: "Handle PR merge (stone + release PR)",
  },
  release: { description: "When the release PR is merged, publish packages", name: "Publish release" },
};

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "templates");

const TEMPLATE_FILENAMES: Record<WorkflowType, string> = {
  "create-stone": "sis-create-stone.yml",
  release: "sis-release.yml",
};

export abstract class CiGenerator {
  abstract readonly provider: Provider;
  protected abstract readonly outputDir: string;

  async generate(workflows: WorkflowType[]): Promise<WorkflowFile[]> {
    const files: WorkflowFile[] = [];

    for (const type of workflows) {
      const content = await this.readTemplate(type);
      const path = this.getOutputPath(type);
      files.push({ content, path });
    }

    return files;
  }

  getExistingFiles(workflows: WorkflowType[]): string[] {
    return workflows.map((type) => this.getOutputPath(type)).filter((path) => existsSync(path));
  }

  protected async readTemplate(type: WorkflowType): Promise<string> {
    const templatePath = join(TEMPLATES_DIR, this.provider, TEMPLATE_FILENAMES[type]);
    return readFile(templatePath, "utf-8");
  }

  protected abstract getOutputPath(type: WorkflowType): string;
}

export class GitHubCiGenerator extends CiGenerator {
  readonly provider = "github" as const;
  protected readonly outputDir = ".github/workflows";

  protected getOutputPath(type: WorkflowType): string {
    return join(this.outputDir, TEMPLATE_FILENAMES[type]);
  }
}

const GITLAB_SISYPHUS_FILE = ".gitlab-ci-sisyphus.yml";

export class GitLabCiGenerator extends CiGenerator {
  readonly provider = "gitlab" as const;
  protected readonly outputDir = ".";

  async generate(workflows: WorkflowType[]): Promise<WorkflowFile[]> {
    const sections: string[] = [];

    sections.push("stages:\n  - sisyphus\n");

    for (const type of workflows) {
      const content = await this.readTemplate(type);
      sections.push(content);
    }

    return [{ content: sections.join("\n"), path: GITLAB_SISYPHUS_FILE }];
  }

  getExistingFiles(_workflows: WorkflowType[]): string[] {
    return existsSync(GITLAB_SISYPHUS_FILE) ? [GITLAB_SISYPHUS_FILE] : [];
  }

  getIncludeInstruction(): string {
    return `include:\n  - local: '${GITLAB_SISYPHUS_FILE}'`;
  }

  protected getOutputPath(_type: WorkflowType): string {
    return GITLAB_SISYPHUS_FILE;
  }
}

export function createCiGenerator(provider: Provider): CiGenerator {
  switch (provider) {
    case "github":
      return new GitHubCiGenerator();
    case "gitlab":
      return new GitLabCiGenerator();
    case "bitbucket":
      throw new Error("Bitbucket CI generation is not supported yet");
  }
}
