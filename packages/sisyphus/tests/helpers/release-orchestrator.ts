import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import { BumpType } from "../../src/domain/BumpType";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import { type ReleaseOptions, ReleaseOrchestrator } from "../../src/services/ReleaseOrchestrator";
import type { ReleaseLedger } from "../../src/services/release-ledger";
import type { ReleaseBuildConfig, SisyphusConfig } from "../../src/types";

export const PACKAGE_NAME = "@fixture/foo";
export const PACKAGE_FILE = "packages/foo/package.json";
export const CHANGELOG_FILE = "packages/foo/CHANGELOG.md";
export const STONE_FILE = ".sisyphus/stones/0001-testtest.json";
export const RELEASE_TAG = "@fixture/foo@1.0.1";
export const PUBLISH_SCRIPT = join(import.meta.dir, "../../../../tools/scripts/publish-package.ts");

export const BASE_OPTIONS: ReleaseOptions = {
  changelog: true,
  createRelease: false,
  dryRun: false,
  npm: false,
  push: false,
  tags: true,
};

export type Fixture = { root: string; remote: string };

export async function setupReleaseFixture(withChangelog: boolean): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "sisyphus-roll-"));
  const remote = mkdtempSync(join(tmpdir(), "sisyphus-remote-"));

  mkdirSync(join(root, "packages/foo"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "release-fixture", private: true, workspaces: ["packages/*"] }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, PACKAGE_FILE),
    `${JSON.stringify({ name: PACKAGE_NAME, private: true, version: "1.0.0" }, null, 2)}\n`,
  );
  if (withChangelog) writeFileSync(join(root, CHANGELOG_FILE), "# Changelog\n");

  mkdirSync(join(root, ".sisyphus/stones"), { recursive: true });
  const config = { commit: { author: "Sisyphus Test", email: "sisyphus@test.local" } };
  writeFileSync(join(root, ".sisyphus/config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(
    join(root, STONE_FILE),
    `${JSON.stringify({ id: "0001-testtest", message: "pending", patch: [PACKAGE_NAME] })}\n`,
  );
  writeFileSync(join(root, "unrelated.txt"), "original\n");

  await Bun.$`git init -q -b main`.cwd(root).quiet();
  await Bun.$`git config user.email sisyphus@test.local`.cwd(root).quiet();
  await Bun.$`git config user.name "Sisyphus Test"`.cwd(root).quiet();
  await Bun.$`git config commit.gpgsign false`.cwd(root).quiet();
  await Bun.$`git config tag.gpgSign false`.cwd(root).quiet();
  await Bun.$`git config core.hooksPath ${join(root, ".git/no-hooks")}`.cwd(root).quiet();
  await Bun.$`git add -A`.cwd(root).quiet();
  await Bun.$`git commit -q -m init`.cwd(root).quiet();

  await Bun.$`git init -q --bare`.cwd(remote).quiet();
  await Bun.$`git remote add origin ${remote}`.cwd(root).quiet();
  await Bun.$`git push -q -u origin main`.cwd(root).quiet();

  return { remote, root };
}

export function makeConfig(root: string, build?: Partial<ReleaseBuildConfig>): ConfigManager<SisyphusConfig> {
  const config = new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), SISYPHUS_DEFAULT_CONFIG);
  if (build) {
    config.set("release", { ...config.get("release"), build: { ...config.get("release").build, ...build } });
  }
  return config;
}

export function makeOrchestrator(
  root: string,
  options: Partial<ReleaseOptions> = {},
  build?: Partial<ReleaseBuildConfig>,
): ReleaseOrchestrator {
  return new ReleaseOrchestrator(makeConfig(root, build), { ...BASE_OPTIONS, ...options });
}

export function makeRootBuildScript(root: string, emits: Record<string, string> = {}): string[] {
  const lines = [
    'const countFile = Bun.file("root-build-count.txt");',
    "const count = (await countFile.exists()) ? Number(await countFile.text()) : 0;",
    "await Bun.write(countFile, String(count + 1));",
    ...Object.entries(emits).map(
      ([path, contents]) => `await Bun.write(${JSON.stringify(path)}, ${JSON.stringify(contents)});`,
    ),
  ];

  writeFileSync(join(root, "root-build.ts"), `${lines.join("\n")}\n`);
  return ["bun", "root-build.ts"];
}

export function makePackage(): Package {
  return new Package({
    bump: BumpType.Patch,
    file: PACKAGE_FILE,
    isPrivate: true,
    name: PACKAGE_NAME,
    version: "1.0.0",
  });
}

export function makePendingStone(): Stone {
  return Stone.fromJson({ id: "0001-testtest", message: "ship it", patch: [PACKAGE_NAME] });
}

export type PublishPackageOptions = {
  commitChanges?: boolean;
  packManifestChanges?: boolean;
  packSourceChanges?: boolean;
  preparationFails?: boolean;
  private?: boolean;
  sourceChanges?: boolean;
};

export function makePublishPackage(
  root: string,
  directory: string,
  name: string,
  options: PublishPackageOptions = {},
): Package {
  const file = join(directory, "package.json");
  const prepareScript = [
    'const countFile = Bun.file("build-count.txt");',
    "const count = (await countFile.exists()) ? Number(await countFile.text()) : 0;",
    "await Bun.write(countFile, String(count + 1));",
    options.sourceChanges ? 'await Bun.write("source.ts", "export const changed = true;\\n");' : "",
    options.commitChanges ? 'await Bun.$`git commit -q --allow-empty -m "build moved head"`;' : "",
    options.packSourceChanges || options.packManifestChanges
      ? [
          'const watcher = Bun.spawn([process.execPath, "pack-watcher.ts"], { stderr: "ignore", stdout: "ignore" });',
          "watcher.unref();",
        ].join("\n")
      : "",
    options.preparationFails ? "process.exit(1);" : "",
  ].join("\n");

  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, ".gitignore"), "build-count.txt\n");
  writeFileSync(join(root, directory, "prepare.ts"), `${prepareScript}\n`);
  if (options.sourceChanges || options.packSourceChanges) {
    writeFileSync(join(root, directory, "source.ts"), "export const changed = false;\n");
  }
  if (options.packSourceChanges || options.packManifestChanges) {
    const mutation = options.packManifestChanges
      ? [
          'const manifest = await Bun.file("package.json").json();',
          'await Bun.write("package.json", JSON.stringify({ ...manifest, dependencies: { injected: "1.0.0" } }, null, 2) + "\\n");',
        ]
      : ['await Bun.write("source.ts", "export const changed = true;\\n");'];
    writeFileSync(join(root, directory, "pack-watcher.ts"), ["await Bun.sleep(100);", ...mutation].join("\n"));
  }
  writeFileSync(
    join(root, file),
    `${JSON.stringify(
      {
        name,
        private: options.private ?? false,
        scripts: {
          build: "bun prepare.ts",
          "package:prepare": "bun prepare.ts",
          "package:publish": `bun ${PUBLISH_SCRIPT} .`,
        },
        version: "1.0.0",
      },
      null,
      2,
    )}\n`,
  );

  return new Package({ file, isPrivate: options.private ?? false, name, newVersion: "1.0.0", version: "1.0.0" });
}

export async function gitText(root: string, args: string[]): Promise<string> {
  const result = await Bun.$`git ${args}`.cwd(root).quiet();
  return result.stdout.toString().trim();
}

export async function recordReleaseCommit(ledger: ReleaseLedger, root: string, commit: string): Promise<void> {
  await ledger.setExpectedReleaseTree(await gitText(root, ["rev-parse", `${commit}^{tree}`]));
  await ledger.setReleaseCommit(commit);
}
