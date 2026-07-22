import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TEMPLATE_ROOT = join(import.meta.dir, "../../../src/commands/actions/templates");
const REPOSITORY_RELEASE_WORKFLOW = join(import.meta.dir, "../../../../../.github/workflows/release.yml");

describe("release workflow templates", () => {
  test("GitHub provisions npm 11 and npm authentication", async () => {
    const template = await readFile(join(TEMPLATE_ROOT, "github/sis-release.yml"), "utf-8");

    expect(template).toContain("actions/setup-node@v6");
    expect(template).toContain("npm@11.5.1");
    expect(template).toContain("NODE_AUTH_TOKEN: $" + "{{ secrets.NPM_TOKEN }}");
    expect(template).toContain("id-token: write");
    expect(template).toContain("actions/cache/restore@v5");
    expect(template).toContain("actions/cache/save@v5");
    expect(template).toContain("if: always()");
    expect(template).toContain("rm -f .git/sisyphus/release/.write.lock");
    expect(template).toContain("sis roll --resume");
    expect(template).toContain("cancel-in-progress: false");
  });

  test("GitLab provisions npm 11 and registry authentication", async () => {
    const template = await readFile(join(TEMPLATE_ROOT, "gitlab/sis-release.yml"), "utf-8");

    expect(template).toContain("apk add --no-cache git nodejs npm");
    expect(template).toContain("npm@11.5.1");
    expect(template).toContain("npm config set //registry.npmjs.org/:_authToken");
    expect(template).toContain(".git/sisyphus/release/");
    expect(template).toContain("rm -f .git/sisyphus/release/.write.lock");
    expect(template).toContain("sis roll --resume");
    expect(template).toContain("resource_group: sisyphus-release");
  });

  test("repository release workflow keeps the push remote credential-free", async () => {
    const workflow = await readFile(REPOSITORY_RELEASE_WORKFLOW, "utf-8");

    expect(workflow).toContain("token: $" + "{{ secrets.GITHUB_TOKEN }}");
    expect(workflow).not.toContain("x-access-token");
    expect(workflow).not.toContain("git remote set-url");
  });
});
