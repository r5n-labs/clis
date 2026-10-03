import { readFile, writeFile } from "node:fs/promises";
import { updateJson } from "@r5n/cli-core";
import type { Package } from "../domain";
import { requireSemver } from "../domain/semver";

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

    requireSemver(newVersion, `write the new version of ${pkg.name}`);

    const content = await readFile(pkg.file, "utf-8");
    this.originals.set(pkg.file, content);

    await writeFile(pkg.file, updateJson(content, { ...JSON.parse(content), version: newVersion }), "utf-8");
  }
}
