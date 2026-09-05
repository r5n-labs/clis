import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FixturePackage = {
  name: string;
  private?: boolean;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export function createWorkspaceFixture(packages: FixturePackage[], prefix = "sisyphus-test-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const rootJson = { name: "fixture-root", private: true, version: "0.0.0", workspaces: ["packages/*"] };
  writeFileSync(join(root, "package.json"), `${JSON.stringify(rootJson, null, 2)}\n`);

  for (const pkg of packages) {
    const dir = join(root, "packages", packageDirName(pkg.name));
    mkdirSync(dir, { recursive: true });
    const json = {
      ...(pkg.dependencies ? { dependencies: pkg.dependencies } : {}),
      ...(pkg.devDependencies ? { devDependencies: pkg.devDependencies } : {}),
      name: pkg.name,
      ...(pkg.optionalDependencies ? { optionalDependencies: pkg.optionalDependencies } : {}),
      ...(pkg.peerDependencies ? { peerDependencies: pkg.peerDependencies } : {}),
      private: pkg.private ?? false,
      version: pkg.version ?? "1.0.0",
    };
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(json, null, 2)}\n`);
  }

  return root;
}

export function packageDirName(name: string): string {
  return name.split("/").pop() ?? name;
}
