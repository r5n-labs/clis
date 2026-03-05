import { readFile, writeFile } from "node:fs/promises";
import type { Package } from "../domain";

export class PackageUpdater {
  private originals = new Map<string, string>();

  async updateAll(packages: Package[]) {
    this.originals.clear();

    for (const pkg of packages) {
      await this.updatePackage(pkg);
    }
  }

  async rollback() {
    for (const [file, content] of this.originals) {
      await writeFile(file, content, "utf-8");
    }
    this.originals.clear();
  }

  private async updatePackage(pkg: Package) {
    const newVersion = pkg.newVersion;
    if (!newVersion) return;

    const content = await readFile(pkg.file, "utf-8");
    this.originals.set(pkg.file, content);

    const json = JSON.parse(content);
    json.version = newVersion;

    const indent = this.detectIndent(content);
    const updatedContent = `${JSON.stringify(json, null, indent)}\n`;
    await writeFile(pkg.file, updatedContent, "utf-8");
  }

  private detectIndent(content: string): string | number {
    const match = content.match(/^[\t ]+/m);
    return match ? match[0] : 2;
  }
}
