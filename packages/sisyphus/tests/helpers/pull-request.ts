import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoneJson } from "../../src/domain/Stone";
import { createWorkspaceFixture } from "./workspace";

const EXECUTABLE_MODE = 0o755;
const GITHUB_PAGE_SIZE = 30;
const HTTP_FAILURE = 503;
const CLI_PATH = join(import.meta.dir, "../../src/cli.ts");

export type ProviderName = "github" | "gitlab";

export type PrFixtureResponse = {
  commits: string[];
  files: unknown[];
  changes: unknown[];
  overflow: unknown;
  failFiles?: boolean;
  pr: {
    number: number;
    title: string;
    body: string;
    html_url: string;
    merged: boolean;
    merge_commit_sha: string;
    user: { login: string };
    base: { ref: string };
    head: { ref: string };
    labels: { name: string }[];
  };
};

export type PrFixture = {
  root: string;
  response: PrFixtureResponse;
  env: NodeJS.ProcessEnv;
  server?: ReturnType<typeof Bun.serve>;
};

export async function prGit(root: string, args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return stdout.trim();
}

export function writeGitHubPrShim(bin: string): void {
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const response = JSON.parse(readFileSync(process.env.SIS_TEST_RESPONSE, "utf8"));
appendFileSync(process.env.SIS_TEST_CALLS, JSON.stringify(args) + "\\n");
if (args[0] === "auth") process.exit(0);
if (args[0] === "pr") {
  const pr = response.pr;
  console.log(JSON.stringify({ number: pr.number, title: pr.title, body: pr.body, url: pr.html_url, state: pr.merged ? "MERGED" : "OPEN", headRefName: pr.head.ref, baseRefName: pr.base.ref, mergeCommit: { oid: pr.merge_commit_sha }, author: pr.user, labels: pr.labels }));
} else if (args[1].endsWith("/commits")) {
  console.log(response.commits.join("\\n"));
} else if (args[1].endsWith("/files")) {
  if (response.failFiles) process.exit(1);
  const pages = [];
  for (let index = 0; index < response.files.length; index += ${GITHUB_PAGE_SIZE}) pages.push(response.files.slice(index, index + ${GITHUB_PAGE_SIZE}));
  if (pages.length === 0) pages.push([]);
  const selected = args.includes("--paginate") ? pages : pages.slice(0, 1);
  if (args.includes("--jq")) for (const page of selected) console.log(page.map(file => file.filename).join("\\n"));
  else if (args.includes("--slurp")) console.log(JSON.stringify(selected));
  else for (const page of selected) console.log(JSON.stringify(page));
} else console.log(JSON.stringify(response.pr));
`,
    { mode: EXECUTABLE_MODE },
  );
}

export async function createPrFixture(provider: ProviderName = "github"): Promise<PrFixture> {
  const root = createWorkspaceFixture([{ name: "@fixture/foo" }, { name: "@fixture/bar" }], "sisyphus-pr-command-");
  mkdirSync(join(root, ".sisyphus"));
  writeFileSync(join(root, ".sisyphus/config.json"), '{"stones":[]}\n');
  await prGit(root, ["init", "-b", "main"]);
  await prGit(root, ["config", "user.name", "Fixture"]);
  await prGit(root, ["config", "user.email", "fixture@example.com"]);
  await prGit(root, ["config", "commit.gpgsign", "false"]);
  await prGit(root, ["config", "core.hooksPath", join(root, ".git/no-hooks")]);
  await prGit(root, ["remote", "add", "origin", `https://${provider}.com/current/project.git`]);
  await prGit(root, ["add", "."]);
  await prGit(root, ["commit", "-m", "chore: initial"]);

  const url = `https://${provider}.com/current/project/${provider === "github" ? "pull" : "-/merge_requests"}/7`;
  const paths = ["packages/foo/index.ts", "packages/bar/index.ts"];
  const response: PrFixtureResponse = {
    changes: paths.map((path) => ({ new_path: path, old_path: path, renamed_file: false })),
    commits: ["unavailable-original"],
    files: paths.map((filename) => ({ filename, status: "modified" })),
    overflow: false,
    pr: {
      number: 7,
      title: "fix: update both packages",
      body: "Both packages changed",
      html_url: url,
      merged: true,
      merge_commit_sha: "unavailable-squash",
      user: { login: "fixture" },
      base: { ref: "main" },
      head: { ref: "feature" },
      labels: [],
    },
  };
  const bin = join(root, "bin");
  writeGitHubPrShim(bin);
  writeFileSync(join(root, "provider-calls"), "");
  const fixture: PrFixture = {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SIS_TEST_RESPONSE: join(root, "response.json"),
      SIS_TEST_CALLS: join(root, "provider-calls"),
    },
    response,
    root,
  };
  if (provider === "gitlab") {
    fixture.server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/commits")) return Response.json(response.commits.map((id) => ({ id })));
        if (path.endsWith("/changes")) {
          return response.failFiles
            ? new Response("Unavailable", { status: HTTP_FAILURE })
            : Response.json({ changes: response.changes, overflow: response.overflow });
        }
        const pr = response.pr;
        return Response.json({
          iid: pr.number,
          title: pr.title,
          description: pr.body,
          web_url: pr.html_url,
          state: pr.merged ? "merged" : "opened",
          target_branch: pr.base.ref,
          source_branch: pr.head.ref,
          merge_commit_sha: pr.merge_commit_sha,
          author: { username: pr.user.login },
          labels: pr.labels.map((label) => label.name),
        });
      },
    });
    fixture.env.CI_API_V4_URL = String(fixture.server.url).replace(/\/$/, "");
    fixture.env.GITLAB_TOKEN = "synthetic-test-token";
  }
  return fixture;
}

export async function runPr(
  fixture: PrFixture,
  args: string[] = [],
): Promise<{ exitCode: number; output: string; stones: StoneJson[] }> {
  writeFileSync(join(fixture.root, "response.json"), JSON.stringify(fixture.response));
  const child = Bun.spawn([process.execPath, CLI_PATH, "pr", "--url", fixture.response.pr.html_url, "--yes", ...args], {
    cwd: fixture.root,
    env: fixture.env,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const directory = join(fixture.root, ".sisyphus/stones");
  const stones = existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .map((name): StoneJson => JSON.parse(readFileSync(join(directory, name), "utf8")))
    : [];
  return { exitCode, output: stdout + stderr, stones };
}
