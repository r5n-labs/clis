import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeGitHubPrShim } from "../helpers/pull-request";
import { createWorkspaceFixture } from "../helpers/workspace";

const roots: string[] = [];
const CORE_PATH = resolve(import.meta.dir, "../../../core/index.ts");
const CONSTANTS_PATH = resolve(import.meta.dir, "../../src/constants.ts");
const ANALYZER_PATH = resolve(import.meta.dir, "../../src/services/PullRequestAnalyzer.ts");

async function git(root: string, args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stderr: "pipe", stdout: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (status !== 0) throw new Error(stderr);
  return stdout.trim();
}

async function fixture() {
  const root = createWorkspaceFixture([{ name: "@fixture/foo" }, { name: "@fixture/bar" }], "sisyphus-pr-analysis-");
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.com"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await git(root, ["config", "core.hooksPath", join(root, ".git/no-hooks")]);
  await git(root, ["remote", "add", "origin", "https://github.com/current/project.git"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "chore: initial"]);
  const commits: string[] = [];
  for (const name of ["foo", "bar"]) {
    writeFileSync(join(root, `packages/${name}/index.ts`), `export const ${name} = true;\n`);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", `feat: update ${name}`]);
    commits.push(await git(root, ["rev-parse", "HEAD"]));
  }
  const response = {
    commits,
    files: ["packages/foo/index.ts", "packages/bar/index.ts"].map((filename) => ({ filename, status: "modified" })),
    pr: {
      number: 7,
      title: "feat: update both packages",
      body: "Both packages changed",
      html_url: "https://github.com/current/project/pull/7",
      merged: true,
      merge_commit_sha: commits.at(-1),
      user: { login: "fixture" },
      base: { ref: "main" },
      head: { ref: "feature" },
      labels: [],
    },
  };
  const bin = join(root, "bin");
  writeGitHubPrShim(bin);
  writeFileSync(join(root, "response.json"), JSON.stringify(response));
  writeFileSync(join(root, "provider-calls"), "");
  return { bin, root };
}

async function analyse(f: Awaited<ReturnType<typeof fixture>>, url?: string) {
  const source = `
import { ConfigManager } from ${JSON.stringify(CORE_PATH)};
import { SISYPHUS_DEFAULT_CONFIG } from ${JSON.stringify(CONSTANTS_PATH)};
import { PullRequestAnalyzer } from ${JSON.stringify(ANALYZER_PATH)};
const config = new ConfigManager(".sisyphus/config.json", SISYPHUS_DEFAULT_CONFIG);
try {
  const result = await new PullRequestAnalyzer(config).analyze(${JSON.stringify(url)});
  console.log(JSON.stringify({ ...result, packages: [...result.packages].sort() }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
`;
  const proc = Bun.spawn([process.execPath, "--eval", source], {
    cwd: f.root,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      SIS_TEST_RESPONSE: join(f.root, "response.json"),
      SIS_TEST_CALLS: join(f.root, "provider-calls"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("PullRequestAnalyzer", () => {
  test.each(["https://github.com/foreign/project/pull/7", "https://github.com/current/other/pull/7"])(
    "rejects another repository URL before fetching its PR number from origin: %s",
    async (url) => {
      const f = await fixture();
      const result = await analyse(f, url);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("PR URL does not match this repository");
      expect(readFileSync(join(f.root, "provider-calls"), "utf8")).not.toContain("/pulls/7");
    },
  );

  test("analyses every commit in a rebased PR when its merge tip matches the provider commit list", async () => {
    const result = await analyse(await fixture());
    expect(result.exitCode).toBe(0);
    const analysis = JSON.parse(result.stdout);
    expect(analysis.packages).toEqual(["@fixture/bar", "@fixture/foo"]);
    expect(analysis.commits.map((commit: { subject: string }) => commit.subject)).toEqual([
      "feat: update foo",
      "feat: update bar",
    ]);
  });
});
