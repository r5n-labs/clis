import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommitInfo, Package, Stone } from "../domain";
import { BUMP_EMOJI } from "../domain";
import type { ChangelogConfig } from "../types";
import { GitRemoteParser } from "./GitRemoteParser";

export class ChangelogGenerator {
  private config: ChangelogConfig;
  private originals = new Map<string, string | null>();
  private remoteParser = new GitRemoteParser();
  private commitUrlFn: ((hash: string) => string) | null = null;

  constructor(config: ChangelogConfig) {
    this.config = config;
  }

  async generate(stones: Stone[], packages: Package[]) {
    await this.initCommitLinks();
    const packageMap = new Map(packages.map((p) => [p.name, p]));

    for (const pkg of packages) {
      const relevantStones = this.filterStonesForPackage(stones, pkg.name);
      const bumpedDeps = this.getBumpedDependencies(stones, pkg.name, packageMap);
      await this.generateForPackage(relevantStones, pkg, bumpedDeps);
    }

    if (this.config.root) {
      await this.generateRoot(stones, packages);
    }
  }

  private async initCommitLinks() {
    const remoteInfo = await this.remoteParser.getRemoteInfo();
    this.commitUrlFn = remoteInfo?.commitUrl ?? null;
  }

  private getBumpedDependencies(stones: Stone[], packageName: string, packages: Map<string, Package>): Package[] {
    const dependencyNames = new Set<string>();

    for (const stone of stones) {
      if (!stone.dependency.includes(packageName)) continue;

      for (const dep of [...stone.major, ...stone.minor, ...stone.patch]) {
        dependencyNames.add(dep);
      }
    }

    return [...dependencyNames].map((name) => packages.get(name)).filter((p): p is Package => p !== undefined);
  }

  private filterStonesForPackage(stones: Stone[], packageName: string): Stone[] {
    return stones.filter((stone) => this.hasDirectChanges(stone, packageName));
  }

  private hasDirectChanges(stone: Stone, packageName: string): boolean {
    return stone.major.includes(packageName) || stone.minor.includes(packageName) || stone.patch.includes(packageName);
  }

  async rollback() {
    for (const [file, content] of this.originals) {
      if (content === null) {
        await rm(file, { force: true });
      } else {
        await writeFile(file, content, "utf-8");
      }
    }
    this.originals.clear();
  }

  private async generateForPackage(stones: Stone[], pkg: Package, bumpedDependencies: Package[]) {
    const changelogPath = join(dirname(pkg.file), this.config.filename);
    const entry = this.formatEntry(stones, pkg, bumpedDependencies);

    await this.prependToChangelog(changelogPath, entry, pkg.name);
  }

  private async generateRoot(stones: Stone[], packages: Package[]) {
    const changelogPath = this.config.filename;
    const entry = this.formatRootEntry(stones, packages);

    await this.prependToChangelog(changelogPath, entry, "Changelog");
  }

  private async prependToChangelog(path: string, entry: string, defaultTitle: string) {
    const existing = await this.readExisting(path);
    this.originals.set(path, existing);

    const title = existing ? this.extractTitle(existing) : `# ${defaultTitle}`;
    const rest = existing ? this.extractRest(existing) : "";

    const newContent = `${title}\n\n${entry}${rest ? `\n\n${rest}` : ""}\n`;
    await writeFile(path, newContent, "utf-8");
  }

  private async readExisting(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return null;
    }
  }

  private extractTitle(content: string): string {
    const firstLine = content.split("\n")[0] ?? "";
    return firstLine.startsWith("#") ? firstLine : "# Changelog";
  }

  private extractRest(content: string): string {
    const lines = content.split("\n");
    const firstLine = lines[0] ?? "";
    if (!firstLine.startsWith("#")) return content;

    let startIndex = 1;
    while (startIndex < lines.length && lines[startIndex]?.trim() === "") {
      startIndex++;
    }

    return lines.slice(startIndex).join("\n").trim();
  }

  private formatEntry(stones: Stone[], pkg: Package, bumpedDependencies: Package[]): string {
    const version = pkg.newVersion ?? pkg.version;
    const date = this.getDate();
    const emoji = this.getEmoji(pkg);
    const hasDependencyChanges = bumpedDependencies.length > 0;

    const lines = [`## ${emoji} ${version} (${date})`];

    for (const stone of stones) {
      lines.push("", `### ${stone.message}`);
      lines.push("", this.formatStoneContent(stone, pkg.name));
    }

    if (hasDependencyChanges) {
      lines.push("", `### ${this.config.sections.dependencies}`);
      for (const dep of bumpedDependencies) {
        lines.push(`- \`${dep.name}\` ${dep.version} → ${dep.newVersion}`);
      }
    }

    return lines.join("\n");
  }

  private formatRootEntry(stones: Stone[], packages: Package[]): string {
    const date = this.getDate();

    const lines = [`## ${date}`];

    lines.push("", "**Packages**");
    for (const pkg of packages) {
      const emoji = this.getEmoji(pkg);
      const versionText = pkg.newVersion ? `${pkg.version} → ${pkg.newVersion}` : pkg.version;
      lines.push(`- ${emoji} \`${pkg.name}\` ${versionText}`);
    }

    for (const stone of stones) {
      lines.push("", `### ${stone.message}`);
      lines.push("", this.formatStoneContent(stone));
    }

    return lines.join("\n");
  }

  private formatStoneContent(stone: Stone, packageFilter?: string): string {
    const parts: string[] = [];

    if (stone.description) {
      parts.push(this.formatDescription(stone.description));
    }

    const commits =
      packageFilter && stone.commits
        ? this.filterCommitsForPackage(stone.commits, packageFilter)
        : (stone.commits ?? []);

    if (commits.length > 0) {
      parts.push(this.formatCommits(commits));
    }

    return parts.join("\n\n");
  }

  private formatDescription(description: string): string {
    const indented = description
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
    return `<details>\n<summary>Description</summary>\n\n${indented}\n</details>`;
  }

  private getDate(): string {
    return new Date().toISOString().split("T")[0] ?? "";
  }

  private getEmoji(pkg: Package): string {
    return pkg.bump ? BUMP_EMOJI[pkg.bump] : "📦";
  }

  private filterCommitsForPackage(commits: readonly CommitInfo[], packageName: string): readonly CommitInfo[] {
    return commits.filter((commit) => commit.packages.includes(packageName));
  }

  private formatCommits(commits: readonly CommitInfo[]): string {
    return commits.map((commit) => this.formatCommitLine(commit)).join("\n");
  }

  private formatCommitLine(commit: Readonly<CommitInfo>): string {
    const hashDisplay = this.commitUrlFn
      ? `[\`${commit.hash}\`](${this.commitUrlFn(commit.hash)})`
      : `\`${commit.hash}\``;

    const line = `- ${hashDisplay} ${commit.subject}`;

    if (commit.body) {
      const indentedBody = commit.body
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");
      return `${line}\n  <details>\n  <summary>Details</summary>\n\n${indentedBody}\n  </details>`;
    }

    return line;
  }
}
