import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveLedgerPaths } from "../../../src/services/release-ledger/storage";

const TEMPLATE_ROOT = join(import.meta.dir, "../../../src/commands/actions/templates");
const REPOSITORY_RELEASE_WORKFLOW = join(import.meta.dir, "../../../../../.github/workflows/release.yml");
const GITHUB_RELEASE_TEMPLATE = join(TEMPLATE_ROOT, "github/sis-release.yml");
const GITLAB_RELEASE_TEMPLATE = join(TEMPLATE_ROOT, "gitlab/sis-release.yml");
const LEDGER_DIRECTORY = ".git/sisyphus/release";
const RELEASE_DIR_EXPRESSION = "$" + "{{ env.SIS_RELEASE_DIR }}";
const RUN_ID_EXPRESSION = "$" + "{{ github.run_id }}";
const RUN_ATTEMPT_EXPRESSION = "$" + "{{ github.run_attempt }}";

type WorkflowStep = { id?: string; if?: string; run?: string; uses?: string; with?: Record<string, string> };
type GitLabReleaseJob = {
  after_script: string[];
  cache: { key: string; paths: string[]; when: string };
  variables: Record<string, string>;
};

const githubWorkflows = [
  { name: "repository workflow", path: REPOSITORY_RELEASE_WORKFLOW },
  { name: "GitHub template", path: GITHUB_RELEASE_TEMPLATE },
];

const ledgerStates = [
  { files: ["active.json"], name: "an incomplete release", persisted: true },
  { files: ["history/0123.json"], name: "a completed release", persisted: true },
  { files: ["artifacts/0123/.keep"], name: "a rolled-back release", persisted: false },
  { files: [], name: "no release", persisted: false },
];

const githubLedgerCases = githubWorkflows.flatMap(({ name, path }) =>
  ledgerStates.map((state) => ({ ...state, path, workflow: name })),
);

async function readReleaseSteps(path: string): Promise<WorkflowStep[]> {
  const workflow = Bun.YAML.parse(await Bun.file(path).text()) as { jobs: { release: { steps: WorkflowStep[] } } };
  return workflow.jobs.release.steps;
}

function findStepIndex(steps: WorkflowStep[], predicate: (step: WorkflowStep) => boolean): number {
  const index = steps.findIndex(predicate);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function findStep(steps: WorkflowStep[], predicate: (step: WorkflowStep) => boolean): WorkflowStep {
  const step = steps[findStepIndex(steps, predicate)];
  if (!step) throw new Error("Expected a matching workflow step");
  return step;
}

function usesAction(prefix: string): (step: WorkflowStep) => boolean {
  return (step) => step.uses?.startsWith(prefix) === true;
}

function runsScript(fragment: string): (step: WorkflowStep) => boolean {
  return (step) => step.run?.includes(fragment) === true;
}

function stepScript(step: WorkflowStep): string {
  if (!step.run) throw new Error("Expected a run step");
  return step.run;
}

function writeLedgerFiles(root: string, files: string[]): void {
  for (const file of files) {
    const path = join(root, LEDGER_DIRECTORY, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}\n");
  }
}

async function runShell(script: string, cwd: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    cwd,
    env: { ...process.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { exitCode, stderr };
}

describe("release workflow templates", () => {
  let root: string;

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "sisyphus-release-template-")));
    await Bun.$`git init -q -b main`.cwd(root).quiet();
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  test("GitHub provisions npm 11 and npm authentication", async () => {
    const template = await readFile(GITHUB_RELEASE_TEMPLATE, "utf-8");

    expect(template).toContain("npm@11.5.1");
    expect(template).toContain("NODE_AUTH_TOKEN: $" + "{{ secrets.NPM_TOKEN }}");
    expect(template).toContain("id-token: write");
    expect(template).toContain("sis roll --resume");
    expect(template).toContain("cancel-in-progress: false");
    expect(template).toContain("ref: $" + "{{ github.event.pull_request.merge_commit_sha || github.sha }}");
  });

  test.each(githubWorkflows)(
    "$name keeps the release ledger for re-runs of the same workflow run",
    async ({ path }) => {
      const steps = await readReleaseSteps(path);
      const checkout = findStepIndex(steps, usesAction("actions/checkout@"));
      const reset = findStepIndex(steps, runsScript("SIS_RELEASE_DIR="));
      const restore = findStepIndex(steps, usesAction("actions/cache/restore@"));
      const unlock = findStepIndex(steps, runsScript(".write.lock.*.claim"));
      const resume = findStepIndex(steps, runsScript("roll --resume"));
      const save = findStepIndex(steps, usesAction("actions/cache/save@"));
      expect(reset).toBeGreaterThan(checkout);
      expect(restore).toBeGreaterThan(reset);
      expect(unlock).toBeGreaterThan(restore);
      expect(resume).toBeGreaterThan(unlock);
      expect(save).toBeGreaterThan(resume);

      const restoreStep = findStep(steps, usesAction("actions/cache/restore@"));
      const saveStep = findStep(steps, usesAction("actions/cache/save@"));
      const key = restoreStep.with?.key ?? "";
      const restorePrefix = restoreStep.with?.["restore-keys"] ?? "";
      expect(restoreStep.with?.path).toBe(RELEASE_DIR_EXPRESSION);
      expect(saveStep.with?.path).toBe(RELEASE_DIR_EXPRESSION);
      expect(saveStep.with?.key).toBe(key);
      expect(key).toContain(RUN_ID_EXPRESSION);
      expect(key).toContain(RUN_ATTEMPT_EXPRESSION);
      expect(key.startsWith(restorePrefix)).toBe(true);
      expect(restorePrefix).toContain(RUN_ID_EXPRESSION);
      expect(restorePrefix).not.toContain(RUN_ATTEMPT_EXPRESSION);
      expect(await readFile(path, "utf-8")).not.toContain(LEDGER_DIRECTORY);

      const inspectId = saveStep.if?.match(/^always\(\) && steps\.([\w-]+)\.outputs\.save == 'true'$/)?.[1];
      expect(findStepIndex(steps, (step) => step.id === inspectId)).toBeGreaterThan(resume);
      expect(findStep(steps, (step) => step.id === inspectId).if).toBe("always()");
    },
  );

  test.each(githubWorkflows)(
    "$name resets the ledger directory that Sisyphus resolves in a linked worktree",
    async ({ path }) => {
      const steps = await readReleaseSteps(path);
      const reset = findStep(steps, runsScript("SIS_RELEASE_DIR="));
      await Bun.$`git commit -q --allow-empty -m init`.cwd(root).quiet();
      const worktree = join(root, "linked");
      await Bun.$`git worktree add -q ${worktree}`.cwd(root).quiet();
      const releaseDirectory = (await resolveLedgerPaths(worktree)).releaseDirectory;
      writeLedgerFiles(root, ["active.json"]);
      mkdirSync(releaseDirectory, { recursive: true });
      writeFileSync(join(releaseDirectory, "active.json"), "{}\n");
      const githubEnv = join(root, "github-env");

      const result = await runShell(stepScript(reset), worktree, { GITHUB_ENV: githubEnv });

      expect(result).toEqual({ exitCode: 0, stderr: "" });
      const exported = readFileSync(githubEnv, "utf-8").trim().replace("SIS_RELEASE_DIR=", "");
      expect(resolve(worktree, exported)).toBe(releaseDirectory);
      expect(existsSync(releaseDirectory)).toBe(false);
      expect(existsSync(join(root, LEDGER_DIRECTORY, "active.json"))).toBe(true);
    },
  );

  test.each(githubLedgerCases)(
    "$workflow saves the ledger after $name only when it holds state",
    async ({ files, path, persisted }) => {
      const steps = await readReleaseSteps(path);
      const inspectId = findStep(steps, usesAction("actions/cache/save@")).if?.match(/steps\.([\w-]+)\.outputs/)?.[1];
      const inspect = findStep(steps, (step) => step.id === inspectId);
      writeLedgerFiles(root, files);
      const githubOutput = join(root, "github-output");
      writeFileSync(githubOutput, "");

      const result = await runShell(stepScript(inspect), root, {
        GITHUB_OUTPUT: githubOutput,
        SIS_RELEASE_DIR: LEDGER_DIRECTORY,
      });

      expect(result).toEqual({ exitCode: 0, stderr: "" });
      expect(readFileSync(githubOutput, "utf-8").includes("save=true")).toBe(persisted);
    },
  );

  test("GitLab provisions npm 11 and registry authentication", async () => {
    const template = await readFile(GITLAB_RELEASE_TEMPLATE, "utf-8");

    expect(template).toContain("apk add --no-cache git nodejs npm");
    expect(template).toContain("npm@11.5.1");
    expect(template).toContain('if [ -n "$NPM_TOKEN" ]; then');
    expect(template).toContain("npm config set //registry.npmjs.org/:_authToken");
    expect(template).toContain("NPM_TOKEN is not set");
    expect(template).toContain('"$' + "{CI_SERVER_URL}/$" + '{CI_PROJECT_PATH}.git"');
    expect(template).not.toContain("https://$" + "{CI_SERVER_HOST}");
    expect(template).toContain("rm -f .git/sisyphus/release/.write.lock");
    expect(template).toContain(".git/sisyphus/release/.write.lock.*.claim");
    expect(template).toContain("sis roll --resume");
    expect(template).toContain("resource_group: sisyphus-release");
  });

  test("GitLab caches the release ledger of a fresh clone for retries of the same commit", async () => {
    const { release } = Bun.YAML.parse(await Bun.file(GITLAB_RELEASE_TEMPLATE).text()) as { release: GitLabReleaseJob };

    expect(release.variables.GIT_STRATEGY).toBe("clone");
    expect(release.cache.paths).toEqual([`${LEDGER_DIRECTORY}/`]);
    expect(release.cache.when).toBe("always");
    expect(release.cache.key).toContain("$CI_COMMIT_SHA");
  });

  test.each(ledgerStates)(
    "GitLab uploads the ledger after $name only when it holds state",
    async ({ files, persisted }) => {
      const { release } = Bun.YAML.parse(await Bun.file(GITLAB_RELEASE_TEMPLATE).text()) as {
        release: GitLabReleaseJob;
      };
      writeLedgerFiles(root, files);
      mkdirSync(join(root, LEDGER_DIRECTORY), { recursive: true });

      const result = await runShell(release.after_script.join("\n"), root);

      expect(result).toEqual({ exitCode: 0, stderr: "" });
      expect(existsSync(join(root, LEDGER_DIRECTORY))).toBe(persisted);
    },
  );

  test("repository release workflow keeps the push remote credential-free", async () => {
    const workflow = await readFile(REPOSITORY_RELEASE_WORKFLOW, "utf-8");

    expect(workflow).toContain("token: $" + "{{ secrets.GITHUB_TOKEN }}");
    expect(workflow).not.toContain("x-access-token");
    expect(workflow).not.toContain("git remote set-url");
  });
});
