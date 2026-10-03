import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const registries: ReturnType<typeof Bun.serve>[] = [];
const PUBLISH_SCRIPT = join(import.meta.dir, "publish-package.ts");
const PACKAGE_NAME = "@fixture/publish-wrapper";
const NOT_FOUND_STATUS = 404;
const JSON_INDENT = 2;
const USAGE_PATTERN = /Usage: bun \.\/publish-package\.ts \.\/packages\/hydra \[--dry-run\]/;

afterEach(() => {
  for (const registry of registries.splice(0)) registry.stop(true);
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "publish-wrapper-"));
  roots.push(root);
  const packageDirectory = join(root, "package");
  const manifestPath = join(packageDirectory, "package.json");
  const preparationCountPath = join(root, ".git", "preparation-count");
  mkdirSync(packageDirectory);
  const originalManifest = `${JSON.stringify(
    { files: ["source.ts"], name: PACKAGE_NAME, scripts: { "package:prepare": "bun prepare.ts" }, version: "1.0.0" },
    null,
    JSON_INDENT,
  )}\n`;
  writeFileSync(manifestPath, originalManifest);
  writeFileSync(join(packageDirectory, "source.ts"), "export const value = 1;\n");
  writeFileSync(
    join(packageDirectory, "prepare.ts"),
    [
      `const countFile = Bun.file(${JSON.stringify(preparationCountPath)});`,
      "const count = await countFile.exists() ? Number(await countFile.text()) : 0;",
      "await Bun.write(countFile, String(count + 1));",
      'const manifest = await Bun.file("package.json").json();',
      'await Bun.write("package.json", JSON.stringify({ ...manifest, prepared: true }));',
    ].join("\n"),
  );
  await Bun.$`git init -q -b main`.cwd(root).quiet();
  await Bun.$`git config user.email wrapper@test.local`.cwd(root).quiet();
  await Bun.$`git config user.name "Wrapper Test"`.cwd(root).quiet();
  await Bun.$`git add -A`.cwd(root).quiet();
  await Bun.$`git -c commit.gpgsign=false commit -q -m init`.cwd(root).quiet();

  const requests: string[] = [];
  const published: string[] = [];
  const registry = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(request.method);
      if (request.method === "PUT") {
        const publication = (await request.json()) as { name: string };
        published.push(publication.name);
        return Response.json({ ok: true });
      }
      return Response.json({ error: "not_found" }, { status: NOT_FOUND_STATUS });
    },
  });
  registries.push(registry);
  const npmConfig = join(root, ".git", "npmrc");
  const globalConfig = join(root, ".git", "global-npmrc");
  writeFileSync(npmConfig, `registry=${registry.url}\n//${registry.url.host}/:_authToken=test-token\n`);
  writeFileSync(globalConfig, "");
  const env = {
    ...process.env,
    NPM_CONFIG_FETCH_RETRIES: "0",
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_PROVENANCE: "false",
    NPM_CONFIG_REGISTRY: String(registry.url),
    NPM_CONFIG_USERCONFIG: npmConfig,
  };

  async function invoke(args: string[]) {
    const child = Bun.spawn([process.execPath, PUBLISH_SCRIPT, ...args], {
      cwd: root,
      env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, output: `${stdout}\n${stderr}` };
  }

  return { invoke, manifestPath, originalManifest, preparationCountPath, published, requests };
}

describe("publish-package entry point", () => {
  test.each([
    { args: ["package"], dryRun: false },
    { args: ["--dry-run", "package"], dryRun: true },
    { args: ["package", "--dry-run"], dryRun: true },
  ])("prepares once and restores the source manifest for %j", async ({ args, dryRun }) => {
    const fixture = await createFixture();

    const result = await fixture.invoke([...args]);

    expect(result.output).not.toContain("Publish failed");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(fixture.preparationCountPath, "utf8")).toBe("1");
    expect(readFileSync(fixture.manifestPath, "utf8")).toBe(fixture.originalManifest);
    expect(fixture.published).toEqual(dryRun ? [] : [PACKAGE_NAME]);
    if (dryRun) expect(fixture.requests).toEqual([]);
  });

  test.each([
    { args: ["package", "--dry-run", "--dry-run"], error: "Duplicate flag: --dry-run" },
    { args: ["--dry-run", "--dry-run"], error: "Duplicate flag: --dry-run" },
    { args: ["package", "--tag"], error: "Unknown flag: --tag" },
    { args: ["-f"], error: "Unknown flag: -f" },
    { args: ["package", "extra"], error: "Unexpected extra package: extra" },
    { args: ["package", "--dry-run", "extra"], error: "Unexpected extra package: extra" },
    { args: [], error: "No package provided" },
    { args: ["--dry-run"], error: "No package provided" },
  ])("rejects invalid arguments before preparation: %j", async ({ args, error }) => {
    const fixture = await createFixture();

    const result = await fixture.invoke([...args]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(error);
    expect(result.output).toMatch(USAGE_PATTERN);
    expect(existsSync(fixture.preparationCountPath)).toBe(false);
    expect(readFileSync(fixture.manifestPath, "utf8")).toBe(fixture.originalManifest);
    expect(fixture.requests).toEqual([]);
  });
});
