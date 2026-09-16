import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseNpmPackOutput } from "./package-artifact";

const roots: string[] = [];
const registries: ReturnType<typeof Bun.serve>[] = [];
const PACKAGE_NAME = "@fixture/publish-artifact";
const NOT_FOUND_STATUS = 404;

afterEach(() => {
  for (const registry of registries.splice(0)) registry.stop(true);
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

async function publishFixture(
  version: string,
  options: { access?: string; dryRun?: boolean; tag?: string; withoutCredentials?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "publish-artifact-test-"));
  roots.push(root);
  const packageDirectory = join(root, "package");
  const artifactDirectory = join(root, "artifact");
  mkdirSync(packageDirectory);
  mkdirSync(artifactDirectory);
  writeFileSync(
    join(packageDirectory, "package.json"),
    JSON.stringify({ name: PACKAGE_NAME, publishConfig: { access: options.access, tag: options.tag }, version }),
  );
  const pack = await Bun.$`npm pack --ignore-scripts --json --pack-destination ${artifactDirectory}`
    .cwd(packageDirectory)
    .quiet();
  const filename = parseNpmPackOutput(pack.stdout.toString())?.filename;
  if (typeof filename !== "string") throw new Error("Expected npm pack to produce an artifact filename");
  const artifactPath = join(artifactDirectory, filename);
  const publications: { access: string; "dist-tags": Record<string, string> }[] = [];
  const requests: string[] = [];
  const registry = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(request.method);
      if (request.method === "PUT") {
        publications.push(await request.json());
        return Response.json({ ok: true });
      }
      return Response.json({ error: "not_found" }, { status: NOT_FOUND_STATUS });
    },
  });
  registries.push(registry);
  const npmConfig = join(root, "npmrc");
  const tokenConfig = options.withoutCredentials ? "" : `//${registry.url.host}/:_authToken=test-token\n`;
  writeFileSync(npmConfig, `registry=${registry.url}\n${tokenConfig}`);
  const globalConfig = join(root, "global-npmrc");
  writeFileSync(globalConfig, "");
  const env: Record<string, string | undefined> = {
    ...process.env,
    NPM_CONFIG_FETCH_RETRIES: "0",
    NPM_CONFIG_FORCE: "false",
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_PROVENANCE: "false",
    NPM_CONFIG_REGISTRY: String(registry.url),
    NPM_CONFIG_USERCONFIG: npmConfig,
  };
  delete env.NPM_CONFIG_TAG;
  delete env.npm_config_tag;
  const invocation = `import { publishPackageArtifact } from ${JSON.stringify(join(import.meta.dir, "package-artifact.ts"))}; await publishPackageArtifact(${JSON.stringify(artifactPath)}, ${JSON.stringify({ cwd: packageDirectory, dryRun: options.dryRun })});`;
  const child = Bun.spawn([process.execPath, "-e", invocation], {
    cwd: packageDirectory,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, output: `${stdout}\n${stderr}`, publications, requests };
}

describe("publishPackageArtifact", () => {
  test("honours restricted access from the packed manifest", async () => {
    const result = await publishFixture("1.0.0", { access: "restricted" });
    expect(result.exitCode).toBe(0);
    expect(result.publications.map((publication) => publication.access)).toEqual(["restricted"]);
  });

  test("refuses invalid access before contacting the registry", async () => {
    const result = await publishFixture("1.0.0", { access: "restriced" });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("Invalid publishConfig.access");
    expect(result.requests).toEqual([]);
  });

  test.each([
    ["1.0.0-beta.2", "beta", "1.0.0-beta.2"],
    ["0.0.0-nightly-20260905120000", "nightly", "0.0.0-nightly-20260905120000"],
    ["1.0.0-rc.1+build.2", "rc", "1.0.0-rc.1"],
  ])("publishes %s under its prerelease channel", async (version, tag, publishedVersion) => {
    const result = await publishFixture(version);

    expect(result.exitCode).toBe(0);
    expect(result.publications.map((publication) => publication["dist-tags"])).toEqual([{ [tag]: publishedVersion }]);
  });

  test("dry-run selects the prerelease channel without overriding npm safeguards", async () => {
    const result = await publishFixture("1.0.0-beta.2", { dryRun: true, withoutCredentials: true });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("with tag beta");
    expect(result.output).not.toContain("using --force");
    expect(result.publications).toEqual([]);
    expect(result.requests).toEqual([]);
  });

  test("preserves an explicit publishConfig tag", async () => {
    const result = await publishFixture("1.0.0-beta.2", { tag: "preview" });

    expect(result.exitCode).toBe(0);
    expect(result.publications.map((publication) => publication["dist-tags"])).toEqual([{ preview: "1.0.0-beta.2" }]);
  });

  test("fails before publication when a numeric prerelease identifier cannot be an npm tag", async () => {
    const result = await publishFixture("1.0.0-1.0");

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("Tag name must not be a valid SemVer range");
    expect(result.publications).toEqual([]);
  });

  test("keeps the default latest tag for stable releases", async () => {
    const result = await publishFixture("1.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.publications.map((publication) => publication["dist-tags"])).toEqual([{ latest: "1.0.0" }]);
  });

  test("inspects stable releases offline without credentials", async () => {
    const result = await publishFixture("1.0.0", { dryRun: true, withoutCredentials: true });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("with tag latest");
    expect(result.requests).toEqual([]);
  });
});
