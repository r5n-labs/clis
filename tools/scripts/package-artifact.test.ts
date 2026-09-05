import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseNpmPackOutput, preparePackageArtifact } from "./package-artifact";

const roots: string[] = [];
const PACK_DELAY_FILE_SIZE = 16 * 1024 * 1024;
const PACK_MUTATION_DELAY_MS = 100;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

type PackageFixtureOptions = {
  commitChanges?: boolean;
  deletesManifest?: boolean;
  packManifestChanges?: boolean;
  prepareFails?: boolean;
  sourceChanges?: boolean;
};

async function createPackageFixture(
  options: PackageFixtureOptions = {},
): Promise<{ artifactPath: string; manifestPath: string; packageDirectory: string; root: string }> {
  const root = mkdtempSync(join(tmpdir(), "package-artifact-repo-"));
  const artifactRoot = mkdtempSync(join(tmpdir(), "package-artifact-output-"));
  roots.push(root, artifactRoot);
  const packageDirectory = join(root, "packages/example");
  const manifestPath = join(packageDirectory, "package.json");
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, "source.ts"), "export const value = 1;\n");
  writeFileSync(
    join(packageDirectory, "prepare.ts"),
    [
      'const manifest = await Bun.file("package.json").json();',
      'await Bun.write("package.json", JSON.stringify({ ...manifest, prepared: true }, null, 2) + "\\n");',
      options.sourceChanges ? 'await Bun.write("source.ts", "export const value = 2;\\n");' : "",
      options.commitChanges
        ? 'await Bun.$`git -c commit.gpgsign=false commit -q --allow-empty -m "prepare moved head"`;'
        : "",
      options.packManifestChanges
        ? [
            'const watcher = Bun.spawn([process.execPath, "manifest-watcher.ts"], { stderr: "ignore", stdout: "ignore" });',
            "watcher.unref();",
          ].join("\n")
        : "",
      options.deletesManifest ? "await Bun.$`rm package.json`;" : "",
      options.prepareFails || options.deletesManifest ? "process.exit(1);" : "",
    ].join("\n"),
  );
  if (options.packManifestChanges) {
    writeFileSync(join(packageDirectory, "large.bin"), randomBytes(PACK_DELAY_FILE_SIZE));
    writeFileSync(
      join(packageDirectory, "manifest-watcher.ts"),
      [
        `await Bun.sleep(${PACK_MUTATION_DELAY_MS});`,
        'const manifest = await Bun.file("package.json").json();',
        'await Bun.write("package.json", JSON.stringify({ ...manifest, dependencies: { injected: "1.0.0" } }, null, 2) + "\\n");',
      ].join("\n"),
    );
  }
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        files: options.packManifestChanges ? ["source.ts", "large.bin"] : ["source.ts"],
        name: "@fixture/package-artifact",
        scripts: { "package:prepare": "bun prepare.ts" },
        version: "1.0.0",
      },
      null,
      2,
    )}\n`,
  );
  await Bun.$`git init -q -b main`.cwd(root).quiet();
  await Bun.$`git config user.email artifact@test.local`.cwd(root).quiet();
  await Bun.$`git config user.name "Artifact Test"`.cwd(root).quiet();
  await Bun.$`git add -A`.cwd(root).quiet();
  await Bun.$`git -c commit.gpgsign=false commit -q -m init`.cwd(root).quiet();
  return { artifactPath: join(artifactRoot, "package.tgz"), manifestPath, packageDirectory, root };
}

describe("preparePackageArtifact", () => {
  test("packs a controlled manifest rewrite and restores the source manifest", async () => {
    const fixture = await createPackageFixture();
    const originalManifest = readFileSync(fixture.manifestPath, "utf-8");

    await preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath);

    expect(existsSync(fixture.artifactPath)).toBe(true);
    const packedManifest = JSON.parse(
      (await Bun.$`tar -xOf ${fixture.artifactPath} package/package.json`.quiet()).stdout.toString(),
    ) as { prepared?: unknown };
    expect(packedManifest.prepared).toBe(true);
    expect(readFileSync(fixture.manifestPath, "utf-8")).toBe(originalManifest);
    expect((await Bun.$`git status --porcelain`.cwd(fixture.root).quiet()).stdout.toString()).toBe("");
  });

  test("restores the manifest when preparation mutates it and then fails", async () => {
    const fixture = await createPackageFixture({ prepareFails: true });
    const originalManifest = readFileSync(fixture.manifestPath, "utf-8");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow();

    expect(existsSync(fixture.artifactPath)).toBe(false);
    expect(readFileSync(fixture.manifestPath, "utf-8")).toBe(originalManifest);
    expect((await Bun.$`git status --porcelain`.cwd(fixture.root).quiet()).stdout.toString()).toBe("");
  });

  test("restores the manifest when preparation deletes it and then fails", async () => {
    const fixture = await createPackageFixture({ deletesManifest: true });
    const originalManifest = readFileSync(fixture.manifestPath, "utf-8");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow();

    expect(existsSync(fixture.artifactPath)).toBe(false);
    expect(readFileSync(fixture.manifestPath, "utf-8")).toBe(originalManifest);
    expect((await Bun.$`git status --porcelain`.cwd(fixture.root).quiet()).stdout.toString()).toBe("");
  });

  test("rejects preparation that changes tracked source before packing", async () => {
    const fixture = await createPackageFixture({ sourceChanges: true });
    const originalManifest = readFileSync(fixture.manifestPath, "utf-8");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      "Repository path differs from Git index: packages/example/source.ts",
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
    expect(readFileSync(fixture.manifestPath, "utf-8")).toBe(originalManifest);
    expect(readFileSync(join(fixture.packageDirectory, "source.ts"), "utf-8")).toBe("export const value = 2;\n");
  });

  test("rejects dirty repository source before running package preparation", async () => {
    const fixture = await createPackageFixture();
    writeFileSync(join(fixture.packageDirectory, "source.ts"), "export const value = 2;\n");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      "Repository path differs from Git index: packages/example/source.ts",
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
  });

  test("rejects ignored pre-build files included by the package manifest", async () => {
    const fixture = await createPackageFixture();
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf-8"));
    writeFileSync(
      fixture.manifestPath,
      `${JSON.stringify({ ...manifest, files: ["source.ts", "ignored.js"] }, null, 2)}\n`,
    );
    writeFileSync(join(fixture.packageDirectory, ".gitignore"), "ignored.js\n");
    await Bun.$`git add packages/example`.cwd(fixture.root).quiet();
    await Bun.$`git -c commit.gpgsign=false commit -q -m "include ignored source"`.cwd(fixture.root).quiet();
    writeFileSync(join(fixture.packageDirectory, "ignored.js"), "unbound payload\n");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      /Repository contains ignored build inputs outside node_modules:[\s\S]*packages\/example\/ignored\.js[\s\S]*pristine worktree/,
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
  });

  test("rejects ignored inputs that a build would copy into generated output", async () => {
    const fixture = await createPackageFixture();
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf-8"));
    writeFileSync(
      fixture.manifestPath,
      `${JSON.stringify(
        { ...manifest, files: ["dist"], scripts: { "package:prepare": "bun copy-ignored.ts" } },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(fixture.packageDirectory, "copy-ignored.ts"),
      'await Bun.write("dist/output.js", await Bun.file("payload.txt").text());\n',
    );
    writeFileSync(join(fixture.packageDirectory, ".gitignore"), "dist/\npayload.txt\n");
    await Bun.$`git add packages/example`.cwd(fixture.root).quiet();
    await Bun.$`git -c commit.gpgsign=false commit -q -m "copy ignored source"`.cwd(fixture.root).quiet();
    writeFileSync(join(fixture.packageDirectory, "payload.txt"), "unbound build input\n");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      /Repository contains ignored build inputs outside node_modules:[\s\S]*packages\/example\/payload\.txt[\s\S]*pristine worktree/,
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
  });

  test("rejects tracked source hidden by assume-unchanged", async () => {
    const fixture = await createPackageFixture();
    await Bun.$`git update-index --assume-unchanged packages/example/source.ts`.cwd(fixture.root).quiet();
    writeFileSync(join(fixture.packageDirectory, "source.ts"), "export const hidden = true;\n");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      "Repository index flags hide working tree changes: packages/example/source.ts",
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
  });

  test("rejects ignored package inputs inside a clean submodule", async () => {
    const fixture = await createPackageFixture();
    const dependency = mkdtempSync(join(tmpdir(), "package-artifact-nested-source-"));
    roots.push(dependency);
    writeFileSync(join(dependency, "tracked.js"), "export const tracked = true;\n");
    await Bun.$`git init -q -b main`.cwd(dependency).quiet();
    await Bun.$`git config user.email artifact@test.local`.cwd(dependency).quiet();
    await Bun.$`git config user.name "Artifact Test"`.cwd(dependency).quiet();
    await Bun.$`git add tracked.js`.cwd(dependency).quiet();
    await Bun.$`git -c commit.gpgsign=false commit -q -m init`.cwd(dependency).quiet();
    await Bun.$`git -c protocol.file.allow=always submodule add -q ${dependency} packages/example/vendor/dependency`
      .cwd(fixture.root)
      .quiet();
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf-8"));
    writeFileSync(
      fixture.manifestPath,
      `${JSON.stringify({ ...manifest, files: ["vendor/dependency/ignored.js"] }, null, 2)}\n`,
    );
    await Bun.$`git add packages/example .gitmodules`.cwd(fixture.root).quiet();
    await Bun.$`git -c commit.gpgsign=false commit -q -m "add nested dependency"`.cwd(fixture.root).quiet();
    const submodule = join(fixture.packageDirectory, "vendor/dependency");
    const excludePath = resolve(
      submodule,
      (await Bun.$`git rev-parse --git-path info/exclude`.cwd(submodule).quiet()).stdout.toString().trim(),
    );
    writeFileSync(excludePath, "ignored.js\n", { flag: "a" });
    writeFileSync(join(submodule, "ignored.js"), "unbound nested payload\n");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      /Repository contains ignored build inputs outside node_modules:[\s\S]*packages\/example\/vendor\/dependency\/ignored\.js/,
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
  });

  test("rejects preparation that moves HEAD and restores the manifest", async () => {
    const fixture = await createPackageFixture({ commitChanges: true });
    const originalManifest = readFileSync(fixture.manifestPath, "utf-8");
    const originalHead = (await Bun.$`git rev-parse HEAD`.cwd(fixture.root).quiet()).stdout.toString().trim();

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      "Package preparation changed repository source files outside the publish manifest",
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
    expect(readFileSync(fixture.manifestPath, "utf-8")).toBe(originalManifest);
    expect((await Bun.$`git rev-parse HEAD`.cwd(fixture.root).quiet()).stdout.toString().trim()).not.toBe(originalHead);
  });

  test("rejects concurrent manifest changes while packing and removes the artifact", async () => {
    const fixture = await createPackageFixture({ packManifestChanges: true });
    const originalManifest = readFileSync(fixture.manifestPath, "utf-8");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      "Failed to prepare and restore",
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
    expect(readFileSync(fixture.manifestPath, "utf-8")).not.toBe(originalManifest);
    expect(readFileSync(fixture.manifestPath, "utf-8")).toContain('"injected": "1.0.0"');
  });

  test("rejects an ordinary directory restored at an indexed gitlink", async () => {
    const fixture = await createPackageFixture();
    const dependency = mkdtempSync(join(tmpdir(), "package-artifact-submodule-"));
    roots.push(dependency);
    writeFileSync(join(dependency, "source.txt"), "tracked dependency\n");
    await Bun.$`git init -q -b main`.cwd(dependency).quiet();
    await Bun.$`git config user.email artifact@test.local`.cwd(dependency).quiet();
    await Bun.$`git config user.name "Artifact Test"`.cwd(dependency).quiet();
    await Bun.$`git add source.txt`.cwd(dependency).quiet();
    await Bun.$`git -c commit.gpgsign=false commit -q -m init`.cwd(dependency).quiet();
    await Bun.$`git -c protocol.file.allow=always submodule add -q ${dependency} vendor/dependency`
      .cwd(fixture.root)
      .quiet();
    await Bun.$`git -c commit.gpgsign=false commit -q -am "add dependency"`.cwd(fixture.root).quiet();
    rmSync(join(fixture.root, "vendor/dependency"), { force: true, recursive: true });
    mkdirSync(join(fixture.root, "vendor/dependency"), { recursive: true });
    writeFileSync(join(fixture.root, "vendor/dependency/injected.txt"), "unbound source\n");

    await expect(preparePackageArtifact(fixture.packageDirectory, fixture.artifactPath)).rejects.toThrow(
      "Repository gitlink is not initialized: vendor/dependency",
    );

    expect(existsSync(fixture.artifactPath)).toBe(false);
  });
});

describe("parseNpmPackOutput", () => {
  const entry = {
    filename: "probe-pkg-1.0.0.tgz",
    files: [{ path: "index.js" }],
    name: "@probe/pkg",
    version: "1.0.0",
  };

  test("reads the array document emitted by npm 11", () => {
    expect(parseNpmPackOutput(JSON.stringify([entry]))).toEqual(entry);
  });

  test("reads the package-keyed document emitted by npm 12", () => {
    expect(parseNpmPackOutput(JSON.stringify({ "@probe/pkg": entry }))).toEqual(entry);
  });

  test("returns undefined for empty or scalar documents", () => {
    expect(parseNpmPackOutput("[]")).toBeUndefined();
    expect(parseNpmPackOutput("{}")).toBeUndefined();
    expect(parseNpmPackOutput("null")).toBeUndefined();
  });
});
