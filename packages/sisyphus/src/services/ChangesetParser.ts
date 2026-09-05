import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Exit } from "@r5n/cli-core";
import { record, string } from "banditypes";
import { nonEmpty, type StoneData } from "../domain";

const CHANGESET_DIR = ".changeset";
const CONFIG_FILE = "config.json";
const changesetPackagesSchema = record(string());
const FRONTMATTER_START = 0;
const FRONTMATTER_CONTENT = 1;

export type ChangesetContent = { packages: Record<string, string>; summary: string; filename: string };

export type ChangesetConfig = {
  changelog?: string | [string, unknown] | false;
  commit?: boolean | string | [string, unknown];
  fixed?: string[][];
  linked?: string[][];
  access?: "restricted" | "public";
  baseBranch?: string;
  ignore?: string[];
  updateInternalDependencies?: "patch" | "minor";
  bumpVersionsWithWorkspaceProtocolOnly?: boolean;
  privatePackages?: { tag?: boolean; version?: boolean } | false;
  snapshot?: { useCalculatedVersion?: boolean; prereleaseTemplate?: string };
  prettier?: boolean;
  changedFilePatterns?: string[];
};

export type ParseResult = { changesets: ChangesetContent[]; config: ChangesetConfig | null; errors: string[] };

export class ChangesetParser {
  constructor(private root: string = process.cwd()) {}

  private get changesetDir(): string {
    return join(this.root, CHANGESET_DIR);
  }

  async exists(): Promise<boolean> {
    try {
      await readdir(this.changesetDir);
      return true;
    } catch {
      return false;
    }
  }

  async parse(): Promise<ParseResult> {
    const errors: string[] = [];
    const changesets: ChangesetContent[] = [];

    const files = await this.findChangesetFiles();

    for (const file of files) {
      const result = await this.parseFile(file);
      if (result) {
        changesets.push(result);
      } else {
        errors.push(`Failed to parse: ${file}`);
      }
    }

    const config = await this.parseConfig();

    return { changesets, config, errors };
  }

  private async findChangesetFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.changesetDir);
      return entries.filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => join(this.changesetDir, f));
    } catch {
      return [];
    }
  }

  private async parseFile(filePath: string): Promise<ChangesetContent | null> {
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");

      if (lines[FRONTMATTER_START]?.trim() !== "---") return null;
      const closing = lines.findIndex((line, index) => index > FRONTMATTER_START && line.trim() === "---");
      if (closing < FRONTMATTER_CONTENT) return null;
      const frontmatter = Bun.YAML.parse(lines.slice(FRONTMATTER_CONTENT, closing).join("\n"));
      if (Array.isArray(frontmatter)) return null;
      const packages = changesetPackagesSchema(frontmatter);

      if (Object.keys(packages).length === 0) {
        return null;
      }

      const filename = filePath.split("/").pop() ?? "";

      return {
        filename,
        packages,
        summary: lines
          .slice(closing + FRONTMATTER_CONTENT)
          .join("\n")
          .trim(),
      };
    } catch {
      return null;
    }
  }

  private async parseConfig(): Promise<ChangesetConfig | null> {
    try {
      const configPath = join(this.changesetDir, CONFIG_FILE);
      const content = await readFile(configPath, "utf-8");
      return JSON.parse(content) as ChangesetConfig;
    } catch {
      return null;
    }
  }

  toStoneData(changeset: ChangesetContent): StoneData {
    const major: string[] = [];
    const minor: string[] = [];
    const patch: string[] = [];
    const unsupported: string[] = [];

    for (const [pkg, bump] of Object.entries(changeset.packages)) {
      switch (bump) {
        case "major":
          major.push(pkg);
          break;
        case "minor":
          minor.push(pkg);
          break;
        case "patch":
          patch.push(pkg);
          break;
        default:
          unsupported.push(`${pkg} uses an unsupported bump type "${bump}"`);
      }
    }

    if (unsupported.length > 0) {
      throw new Exit(
        `Changeset ${changeset.filename}: ${unsupported.join("; ")}`,
        "Rewrite them as major, minor, or patch before migrating",
      );
    }

    const lines = changeset.summary.split("\n");
    const firstLine = lines[0]?.trim() || "Migrated from changeset";
    const restOfSummary = lines.slice(1).join("\n").trim();

    return {
      description: restOfSummary || undefined,
      major: nonEmpty(major),
      message: firstLine,
      minor: nonEmpty(minor),
      patch: nonEmpty(patch),
    };
  }
}
