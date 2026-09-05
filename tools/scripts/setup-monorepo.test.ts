import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT_PATH = join(import.meta.dir, "setup-monorepo.ts");
const EXECUTABLE_MODE = 0o755;
let fixture: string;
let project: string;
let bin: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "r5n-setup-"));
  project = join(fixture, "project with spaces and tools");
  bin = join(fixture, "bin");
  mkdirSync(project);
  mkdirSync(bin);
  writeFileSync(
    join(bin, "bun"),
    [
      "#!/bin/sh",
      'if [ "$1" = "install" ] && [ ! -f "$SETUP_DEV_DEPENDENCIES" ]; then',
      '  printf "Script not found: lefthook\\n" >&2',
      "  exit 1",
      "fi",
      'if [ "$SETUP_EXIT_CODE" != "0" ]; then exit "$SETUP_EXIT_CODE"; fi',
      'if [ "$1" = "add" ]; then touch "$SETUP_DEV_DEPENDENCIES"; fi',
      "exit 0",
    ].join("\n"),
  );
  chmodSync(join(bin, "bun"), EXECUTABLE_MODE);
});

afterEach(() => {
  rmSync(fixture, { force: true, recursive: true });
});

async function runSetup(exitCode = "0") {
  const child = Bun.spawn([process.execPath, SCRIPT_PATH], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SETUP_DEV_DEPENDENCIES: join(fixture, "dev-dependencies"),
      SETUP_EXIT_CODE: exitCode,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stderr, stdout };
}

describe("setup-monorepo", () => {
  test("sets up a path with spaces without treating a tools suffix as the tools workspace", async () => {
    const result = await runSetup();
    expect(result.code).toBe(0);
    expect(existsSync(join(fixture, "dev-dependencies"))).toBe(true);
    expect(existsSync(join(project, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(fixture, "package.json"))).toBe(false);
    const manifest = await Bun.file(join(project, "package.json")).json();
    expect(manifest.packageManager).toBe(`bun@${Bun.version}`);
    expect(manifest.scripts.clean).not.toContain("rm -rf bun.lock");
    expect(JSON.stringify(manifest.scripts)).not.toContain("bunx");
  });

  test("preserves workspace catalogues and existing scripts", async () => {
    const catalog = { example: "1.0.0" };
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "existing-project",
        scripts: { lint: "bun custom-lint.ts" },
        workspaces: { catalog, packages: ["apps/*"] },
      }),
    );
    const result = await runSetup();
    expect(result.code).toBe(0);
    const manifest = await Bun.file(join(project, "package.json")).json();
    expect(manifest.workspaces).toEqual({ catalog, packages: ["apps/*", "packages/*", "tools"] });
    expect(manifest.scripts.lint).toBe("bun custom-lint.ts");
  });

  test("fails when dependency installation fails", async () => {
    const result = await runSetup("1");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("install failed: Install dependencies and development tools");
    expect(result.stdout).not.toContain("Monorepo setup completed");
    expect(result.stdout).not.toContain("Running lint");
  });
});
