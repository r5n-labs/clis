import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAnalysis } from "../../src/composition/analysis";
import { collectChanges } from "../../src/contexts/ChangeContextBuilder";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { fixture } from "../helpers";

const SOURCE = "func value():\n    return 1\n";
const INVALID_SOURCE = "func broken(\n";
const EXCLUDED_DIRECTORIES = [".git", ".godot", ".argus", "addons", "node_modules", "dist"];
const REGULAR_MODE = 0o644;
const EXECUTABLE_MODE = 0o755;

function git(root: string, args: string[], input?: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    ...(input === undefined ? {} : { stdin: Buffer.from(input) }),
  });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function commitFixture(root: string): void {
  for (const args of [
    ["init", "--quiet"],
    ["add", "--force", "."],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
  ]) {
    git(root, args);
  }
}

test("default scanning excludes generated directories at every depth", async () => {
  const f = fixture();
  for (const directory of EXCLUDED_DIRECTORIES) {
    f.write(`${directory}/invalid.gd`, INVALID_SOURCE);
    f.write(`packages/example/${directory}/invalid.gd`, INVALID_SOURCE);
  }
  f.write("src/value.gd", SOURCE);
  f.write("packages/example/distribution/value.gd", SOURCE);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  expect([...project.files.keys()].sort()).toEqual(["packages/example/distribution/value.gd", "src/value.gd"]);
});

test("change membership and patches retain captured tracked, untracked and ignored-file decisions", async () => {
  const f = fixture();
  const baseline = new Map([
    ["modified.gd", SOURCE],
    ["reverted.gd", SOURCE],
    ["deleted.gd", SOURCE],
    ["empty-deleted.gd", ""],
    ["late-only.gd", SOURCE],
    ["ignored-tracked.gd", SOURCE],
  ]);
  for (const [path, source] of baseline) f.write(path, source);
  f.write(".gitignore", "ignored-*.gd\n");
  commitFixture(f.loaded.root);
  const captured = SOURCE.replace("return 1", "return 2");
  for (const path of ["modified.gd", "reverted.gd", "ignored-tracked.gd", "new.gd", "staged.gd", "ignored-new.gd"])
    f.write(path, captured);
  for (const path of ["deleted.gd", "empty-deleted.gd"]) rmSync(join(f.loaded.root, path));
  f.write("empty-new.gd", "");
  git(f.loaded.root, ["add", "staged.gd"]);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
  for (const path of ["reverted.gd", "deleted.gd", "ignored-tracked.gd"]) f.write(path, SOURCE);
  f.write("empty-deleted.gd", "");
  f.write(".gitignore", "");
  for (const path of ["modified.gd", "late-only.gd", "late-new.gd"])
    f.write(path, SOURCE.replace("return 1", "return 99"));
  for (const path of ["new.gd", "empty-new.gd", "staged.gd"]) rmSync(join(f.loaded.root, path));
  const changes = await collectChanges(f.loaded, project);
  expect(changes.map((target) => target.path)).toEqual([
    "deleted.gd",
    "empty-deleted.gd",
    "empty-new.gd",
    "ignored-tracked.gd",
    "modified.gd",
    "new.gd",
    "reverted.gd",
    "staged.gd",
  ]);
  const restored = join(f.directory, "restored");
  mkdirSync(restored);
  git(restored, ["init", "--quiet"]);
  for (const [path, source] of baseline) writeFileSync(join(restored, path), source);
  for (const target of changes) {
    const evidence = JSON.parse(target.source);
    const after = project.files.get(target.path)?.source;
    expect(evidence.before).toBe(baseline.get(target.path) ?? "");
    expect(evidence.after).toBe(after ?? "");
    git(restored, ["apply", "-"], evidence.diff);
    if (after === undefined) expect(existsSync(join(restored, target.path))).toBe(false);
    else expect(readFileSync(join(restored, target.path), "utf8")).toBe(after);
  }
  expect(readFileSync(join(restored, "late-only.gd"), "utf8")).toBe(SOURCE);
});

test.each([
  ["nested", ":(glob)wild[1].gd"],
  [" leading\nproject", "line\nbreak.gd"],
])("change baselines retain literal paths under %j", async (directory, name) => {
  const f = fixture();
  f.write(`${directory}/${name}`, SOURCE);
  commitFixture(f.loaded.root);
  const after = SOURCE.replace("return 1", "return 2");
  f.write(`${directory}/${name}`, after);
  const loaded = { ...f.loaded, root: join(f.loaded.root, directory) };
  const project = await new ProjectScanner(createAnalysis()).scan(loaded, "HEAD");
  const changes = await collectChanges(loaded, project);
  expect(changes.map((target) => target.path)).toEqual([name]);
  const evidence = JSON.parse(changes[0]?.source ?? "{}");
  expect(evidence.before).toBe(SOURCE);
  expect(evidence.after).toBe(after);
  expect(evidence.diff).toContain("-    return 1");
  expect(evidence.diff).toContain("+    return 2");
});

test("captured changes retain bounded unified hunks and missing-final-newline markers", async () => {
  const f = fixture();
  const CONTEXT_LINES = 12;
  const source = ["# distant", ...Array.from({ length: CONTEXT_LINES }, () => "# stable"), SOURCE.trimEnd()].join("\n");
  f.write("value.gd", source);
  commitFixture(f.loaded.root);
  f.write("value.gd", source.replace("return 1", "return 2"));
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
  f.write("value.gd", source.replace("return 1", "return 99"));
  const changes = await collectChanges(f.loaded, project);
  const evidence = JSON.parse(changes[0]?.source ?? "{}");
  expect(evidence.diff).toContain("@@");
  expect(evidence.diff).toContain(" # stable\n");
  expect(evidence.diff).toContain("-    return 1\n\\ No newline at end of file");
  expect(evidence.diff).toContain("+    return 2\n\\ No newline at end of file");
  expect(evidence.diff).not.toContain("distant");
  expect(evidence.diff).not.toContain("return 99");
});

test.each([true, false])("captured file modes respect core.filemode=%s", async (honourFileMode) => {
  const f = fixture();
  f.write("mode.gd", SOURCE);
  chmodSync(join(f.loaded.root, "mode.gd"), REGULAR_MODE);
  commitFixture(f.loaded.root);
  git(f.loaded.root, ["config", "core.filemode", String(honourFileMode)]);
  chmodSync(join(f.loaded.root, "mode.gd"), EXECUTABLE_MODE);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
  chmodSync(join(f.loaded.root, "mode.gd"), REGULAR_MODE);
  git(f.loaded.root, ["config", "core.filemode", String(!honourFileMode)]);
  const changes = await collectChanges(f.loaded, project);
  expect(changes).toHaveLength(honourFileMode ? 1 : 0);
  if (honourFileMode) {
    const evidence = JSON.parse(changes[0]?.source ?? "{}");
    expect(evidence.before).toBe(SOURCE);
    expect(evidence.after).toBe(SOURCE);
    expect(evidence.diff).toContain("old mode 100644");
    expect(evidence.diff).toContain("new mode 100755");
  }
});

test("captured sparse-checkout omissions are not reported as deleted source", async () => {
  const f = fixture();
  f.write("sparse.gd", SOURCE);
  f.write("deleted.gd", SOURCE);
  commitFixture(f.loaded.root);
  git(f.loaded.root, ["update-index", "--skip-worktree", "sparse.gd"]);
  rmSync(join(f.loaded.root, "sparse.gd"));
  rmSync(join(f.loaded.root, "deleted.gd"));
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
  git(f.loaded.root, ["update-index", "--no-skip-worktree", "sparse.gd"]);
  const changes = await collectChanges(f.loaded, project);
  expect(changes.map((target) => target.path)).toEqual(["deleted.gd"]);
  const evidence = JSON.parse(changes[0]?.source ?? "{}");
  expect(evidence.before).toBe(SOURCE);
  expect(evidence.after).toBe("");
  expect(evidence.diff).toContain("deleted file mode 100644");
});

test.each([
  [true, "", false],
  [false, "*.gd text eol=crlf\n", false],
  [true, "*.gd -text\n", true],
] as const)(
  "captured Git line-ending policy and base survive later edits: autocrlf=%s attributes=%j",
  async (autocrlf, attributes, literal) => {
    const f = fixture();
    f.write("line-endings.gd", SOURCE);
    f.write("genuine.gd", SOURCE);
    f.write(".gitattributes", attributes);
    git(f.loaded.root, ["init", "--quiet"]);
    git(f.loaded.root, ["config", "core.autocrlf", String(autocrlf)]);
    commitFixture(f.loaded.root);
    const base = git(f.loaded.root, ["rev-parse", "HEAD"]).trim();
    const captured = SOURCE.replace("return 1", "return 2").replaceAll("\n", "\r\n");
    f.write("line-endings.gd", SOURCE.replaceAll("\n", "\r\n"));
    f.write("genuine.gd", captured);
    const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
    f.write("genuine.gd", SOURCE.replace("return 1", "return 99"));
    f.write("line-endings.gd", SOURCE);
    f.write(".gitattributes", "*.gd -text\n");
    git(f.loaded.root, ["config", "core.autocrlf", "false"]);
    commitFixture(f.loaded.root);
    const changes = await collectChanges(f.loaded, project);
    expect(changes.map((target) => target.path)).toEqual(literal ? ["genuine.gd", "line-endings.gd"] : ["genuine.gd"]);
    const evidence = JSON.parse(changes.find((target) => target.path === "genuine.gd")?.source ?? "{}");
    expect(evidence.base).toBe(base);
    expect(evidence.before).toBe(SOURCE);
    expect(evidence.after).toBe(captured);
    expect(evidence.diff).toContain("+    return 2\r\n");
    expect(evidence.diff).not.toContain("return 99");
    if (literal) {
      const lineEndings = JSON.parse(changes.find((target) => target.path === "line-endings.gd")?.source ?? "{}");
      expect(lineEndings.before).toBe(SOURCE);
      expect(lineEndings.after).toBe(SOURCE.replaceAll("\n", "\r\n"));
      expect(lineEndings.diff).toContain("+    return 1\r\n");
    }
  },
);

test("custom root-relative exclusions retain their explicit scope", async () => {
  const f = fixture();
  f.loaded.config.exclude = ["dist/**"];
  f.write("dist/invalid.gd", INVALID_SOURCE);
  f.write("packages/example/dist/value.gd", SOURCE);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  expect([...project.files.keys()]).toEqual(["packages/example/dist/value.gd"]);
});

test("Git baselines skip nested generated files removed from the working tree", async () => {
  const f = fixture();
  f.write("value.gd", SOURCE);
  for (const directory of EXCLUDED_DIRECTORIES.filter((entry) => entry !== ".git")) {
    f.write(`packages/example/${directory}/invalid.gd`, INVALID_SOURCE);
  }
  commitFixture(f.loaded.root);
  rmSync(join(f.loaded.root, "packages"), { recursive: true });
  f.write("value.gd", SOURCE.replace("return 1", "return 2"));
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
  const changes = await collectChanges(f.loaded, project);
  expect(changes.map((target) => target.path)).toEqual(["value.gd"]);
  expect(JSON.parse(changes[0]?.source ?? "{}").before).toBe(SOURCE);
});

test("change reviews skip untracked symlinks and retain regular additions and deletions", async () => {
  const f = fixture();
  f.write("existing.gd", SOURCE);
  f.write("deleted.gd", SOURCE);
  commitFixture(f.loaded.root);
  rmSync(join(f.loaded.root, "deleted.gd"));
  f.write("new.gd", SOURCE);
  f.write("empty.gd", "");
  const outside = join(f.directory, "outside.gd");
  writeFileSync(outside, INVALID_SOURCE);
  symlinkSync(join(f.loaded.root, "existing.gd"), join(f.loaded.root, "alias.gd"));
  symlinkSync(outside, join(f.loaded.root, "escape.gd"));
  symlinkSync(join(f.directory, "missing.gd"), join(f.loaded.root, "broken.gd"));
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded, "HEAD");
  f.write("new.gd", SOURCE.replace("return 1", "return 99"));
  const changes = await collectChanges(f.loaded, project);
  expect(changes.map((target) => target.path)).toEqual(["deleted.gd", "empty.gd", "new.gd"]);
  const addition = JSON.parse(changes.find((target) => target.path === "new.gd")?.source ?? "{}");
  expect(addition.after).toBe(SOURCE);
  expect(addition.diff).toContain("new file mode 100644");
  expect(addition.diff).toContain("+func value():\n+    return 1\n");
  expect(addition.diff).not.toContain("return 99");
  const deletion = JSON.parse(changes.find((target) => target.path === "deleted.gd")?.source ?? "{}");
  expect(deletion.before).toBe(SOURCE);
  expect(deletion.after).toBe("");
  const empty = JSON.parse(changes.find((target) => target.path === "empty.gd")?.source ?? "{}");
  expect(empty.after).toBe("");
  expect(empty.diff).toContain("b/empty.gd");
  expect(empty.diff).toContain("new file mode 100644");
});
