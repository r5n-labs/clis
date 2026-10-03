import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPrFixture, type PrFixture, prGit, runPr } from "../helpers/pull-request";

const fixtures: PrFixture[] = [];
const GITHUB_FILE_LIMIT = 3000;
const FILES_OVER_ONE_PAGE = 31;
const SHORT_HASH_LENGTH = 7;

async function fixture(provider: "github" | "gitlab" = "github"): Promise<PrFixture> {
  const value = await createPrFixture(provider);
  fixtures.push(value);
  return value;
}

afterEach(() => {
  for (const value of fixtures.splice(0)) {
    value.server?.stop(true);
    rmSync(value.root, { force: true, recursive: true });
  }
});

describe("PR stones from provider files", () => {
  test("includes a workspace first changed on a later GitHub files page", async () => {
    const f = await fixture();
    f.response.files = Array.from({ length: FILES_OVER_ONE_PAGE }, (_, index) => ({
      filename: index === FILES_OVER_ONE_PAGE - 1 ? "packages/bar/index.ts" : `packages/foo/${index}.ts`,
      status: "modified",
    }));

    const result = await runPr(f, ["--bump", "patch"]);

    expect(result.exitCode).toBe(0);
    expect(result.stones[0]?.patch).toEqual(["@fixture/foo", "@fixture/bar"]);
    expect(result.stones[0]?.commits?.[0]?.packages).toEqual(["@fixture/foo", "@fixture/bar"]);
  });

  test("refuses GitHub's total file cap before writing release input", async () => {
    const f = await fixture();
    f.response.files = Array.from({ length: GITHUB_FILE_LIMIT }, (_, index) => ({
      filename: `packages/foo/${index}.ts`,
      status: "modified",
    }));
    const original = readFileSync(join(f.root, ".sisyphus/config.json"), "utf8");

    const result = await runPr(f, ["--bump", "patch"]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("GitHub file limit");
    expect(result.stones).toEqual([]);
    expect(readFileSync(join(f.root, ".sisyphus/config.json"), "utf8")).toBe(original);
  });

  test("refuses GitLab overflow before writing release input", async () => {
    const f = await fixture("gitlab");
    f.response.overflow = true;
    const original = readFileSync(join(f.root, ".sisyphus/config.json"), "utf8");

    const result = await runPr(f, ["--bump", "patch"]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("GitLab file list is incomplete");
    expect(result.stones).toEqual([]);
    expect(readFileSync(join(f.root, ".sisyphus/config.json"), "utf8")).toBe(original);
  });

  for (const provider of ["github", "gitlab"] as const) {
    test(`${provider} retains both cross-workspace rename endpoints`, async () => {
      const f = await fixture(provider);
      f.response.files = [
        { filename: "packages/bar/moved.ts", previous_filename: "packages/foo/moved.ts", status: "renamed" },
      ];
      f.response.changes = [
        { new_path: "packages/bar/moved.ts", old_path: "packages/foo/moved.ts", renamed_file: true },
      ];

      const result = await runPr(f, ["--bump", "patch"]);

      expect(result.exitCode).toBe(0);
      expect([...(result.stones[0]?.patch ?? [])].sort()).toEqual(["@fixture/bar", "@fixture/foo"]);
      expect([...(result.stones[0]?.commits?.[0]?.packages ?? [])].sort()).toEqual(["@fixture/bar", "@fixture/foo"]);
    });

    test.each(["line\nbreak", " space "])(`${provider} preserves exact workspace path bytes: %j`, async (directory) => {
      const f = await fixture(provider);
      const path = join(f.root, directory);
      mkdirSync(path);
      writeFileSync(join(path, "package.json"), JSON.stringify({ name: "@fixture/unusual", version: "1.0.0" }));
      writeFileSync(
        join(f.root, "package.json"),
        JSON.stringify({ private: true, workspaces: ["packages/*", directory] }),
      );
      const filename = `${directory}/index.ts`;
      f.response.files = [{ filename, status: "added" }];
      f.response.changes = [{ new_path: filename, old_path: filename, renamed_file: false }];

      const result = await runPr(f, ["--bump", "patch"]);

      expect(result.exitCode).toBe(0);
      expect(result.stones[0]?.patch).toEqual(["@fixture/unusual"]);
    });

    test(`${provider} retains ordinary additions and deletions without duplicate packages`, async () => {
      const f = await fixture(provider);
      f.response.files = [
        { filename: "packages/foo/added.ts", status: "added" },
        { filename: "packages/bar/deleted.ts", status: "removed" },
      ];
      f.response.changes = [
        { new_path: "packages/foo/added.ts", old_path: "packages/foo/added.ts", renamed_file: false, new_file: true },
        {
          new_path: "packages/bar/deleted.ts",
          old_path: "packages/bar/deleted.ts",
          renamed_file: false,
          deleted_file: true,
        },
      ];

      const result = await runPr(f, ["--bump", "patch"]);

      expect(result.exitCode).toBe(0);
      expect(result.stones[0]?.patch).toEqual(["@fixture/foo", "@fixture/bar"]);
    });

    test.each(["transport", "empty", "malformed", "missing rename source"])(
      `${provider} refuses unreliable changed files: %s`,
      async (failure) => {
        const f = await fixture(provider);
        const original = readFileSync(join(f.root, ".sisyphus/config.json"), "utf8");
        if (failure === "transport") f.response.failFiles = true;
        if (failure === "empty") {
          f.response.files = [];
          f.response.changes = [];
        }
        if (failure === "malformed") {
          f.response.files.push({ filename: 42, status: "modified" });
          f.response.changes.push({ new_path: 42, old_path: "packages/bar/bad.ts", renamed_file: false });
        }
        if (failure === "missing rename source") {
          f.response.files = [{ filename: "packages/bar/moved.ts", status: "renamed" }];
          f.response.changes = [{ new_path: "packages/bar/moved.ts", renamed_file: true }];
        }

        const result = await runPr(f, ["--bump", "patch"]);

        expect(result.exitCode).toBe(1);
        expect(result.output).toMatch(/Could not determine changed files|Failed to fetch .* files/);
        expect(result.stones).toEqual([]);
        expect(readFileSync(join(f.root, ".sisyphus/config.json"), "utf8")).toBe(original);
      },
    );
  }
});

describe("PR bump selection", () => {
  test.each(["snapshot", "dependency", ""])(
    "rejects unsupported explicit bump %j without persistence",
    async (bump) => {
      const f = await fixture();
      const original = readFileSync(join(f.root, ".sisyphus/config.json"), "utf8");

      const result = await runPr(f, ["--bump", bump]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Invalid bump type:");
      expect(result.stones).toEqual([]);
      expect(readFileSync(join(f.root, ".sisyphus/config.json"), "utf8")).toBe(original);
    },
  );

  test.each(["major", "minor", "patch"] as const)("persists the explicit %s bump", async (bump) => {
    const result = await runPr(await fixture(), ["--bump", bump]);

    expect(result.exitCode).toBe(0);
    expect(result.stones[0]?.[bump]).toEqual(["@fixture/foo", "@fixture/bar"]);
  });
});

describe("PR persisted commit selection", () => {
  test.each(["all", "narrowed"])("preserves %s selected commit metadata", async (selection) => {
    const narrowed = selection === "narrowed";
    const f = await fixture();
    const sharedSubject = "feat: shared change";
    const sharedBody = "Shared implementation detail";
    for (const name of ["foo", "bar"]) writeFileSync(join(f.root, `packages/${name}/shared.ts`), "export {};\n");
    await prGit(f.root, ["add", "packages"]);
    await prGit(f.root, ["commit", "-m", sharedSubject, "-m", sharedBody]);
    const sharedHash = await prGit(f.root, ["rev-parse", "HEAD"]);
    const barSubject = "fix: bar only";
    writeFileSync(join(f.root, "packages/bar/only.ts"), "export {};\n");
    await prGit(f.root, ["add", "packages"]);
    await prGit(f.root, ["commit", "-m", barSubject]);
    const barHash = await prGit(f.root, ["rev-parse", "HEAD"]);
    f.response.commits = [sharedHash, barHash];
    f.response.pr.merge_commit_sha = barHash;

    const result = await runPr(f, ["--bump", "patch", ...(narrowed ? ["--packages", "@fixture/foo"] : [])]);

    expect(result.exitCode).toBe(0);
    expect([...(result.stones[0]?.patch ?? [])].sort()).toEqual(
      narrowed ? ["@fixture/foo"] : ["@fixture/bar", "@fixture/foo"],
    );
    expect(result.stones[0]?.commits?.map((commit) => ({ ...commit, packages: [...commit.packages].sort() }))).toEqual([
      {
        body: sharedBody,
        hash: sharedHash.slice(0, SHORT_HASH_LENGTH),
        message: "shared change",
        packages: narrowed ? ["@fixture/foo"] : ["@fixture/bar", "@fixture/foo"],
        subject: sharedSubject,
        type: "feat",
      },
      ...(narrowed
        ? []
        : [
            {
              hash: barHash.slice(0, SHORT_HASH_LENGTH),
              message: "bar only",
              packages: ["@fixture/bar"],
              subject: barSubject,
              type: "fix",
            },
          ]),
    ]);
  });
});
