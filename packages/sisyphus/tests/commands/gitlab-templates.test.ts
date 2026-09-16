import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type GitLabJob = { before_script: string[]; script: string[] };
const TEMPLATE_PATH = join(import.meta.dir, "../../src/commands/actions/templates/gitlab/sis-create-stone.yml");
const jobs = Bun.YAML.parse(await Bun.file(TEMPLATE_PATH).text()) as Record<string, GitLabJob>;
const PROJECT_PATH = "group/subgroup/project";
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "gitlab-template-"));
  await Bun.$`git init -q -b main`.cwd(root).quiet();
  await Bun.$`git remote add origin https://gitlab-ci-token:fake-job-token@gitlab.example/group/subgroup/project.git`
    .cwd(root)
    .quiet();
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

async function runScript(script: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(["bash", "-eu", "-c", script], {
    cwd: root,
    env: { ...process.env, CI_PROJECT_PATH: PROJECT_PATH, CI_SERVER_URL: "https://gitlab.example", ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

describe("GitLab create-stone workflow", () => {
  test.each(["handle-merge", "handle-push"])("configures origin credentials for %s release-PR pushes", async (job) => {
    const setup = jobs[job]?.before_script.find((script) => script.includes("git remote set-url"));
    expect(setup).toBeDefined();
    const result = await runScript(
      `${setup}\ngit remote get-url origin\nprintf 'protocol=https\\nhost=gitlab.example\\n\\n' | git credential fill`,
      { GITLAB_TOKEN: "fake-api-token", SIS_PUSH_TOKEN: "fake-push-token" },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`https://gitlab.example/${PROJECT_PATH}.git`);
    expect(result.stdout).toContain("password=fake-push-token");
    expect(result.stdout).not.toContain("fake-job-token");
  });

  test("selects the merge footer's MR rather than another MR mentioned in the description", async () => {
    const script = jobs["handle-merge"]?.script[0];
    if (!script) throw new Error("Expected a merge-request detection script");
    const result = await runScript(script, {
      CI_COMMIT_DESCRIPTION: `Related to !12\n\nSee merge request ${PROJECT_PATH}!34\n`,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Detected MR !34");
    expect(result.stdout).not.toContain("Detected MR !12");
  });

  test("skips a description without this project's merge footer", async () => {
    const script = jobs["handle-merge"]?.script[0];
    if (!script) throw new Error("Expected a merge-request detection script");
    const result = await runScript(script, {
      CI_COMMIT_DESCRIPTION: "Related to !12\nSee merge request other/repo!34",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No MR IID found");
  });
});
