import { expect, test } from "bun:test";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAnalysis } from "../../src/composition/analysis";
import { collectChanges } from "../../src/contexts/ChangeContextBuilder";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { fixture } from "../helpers";

const SOURCE = "func value():\n    return 1\n";
const INVALID_SOURCE = "func broken(\n";
const EXCLUDED_DIRECTORIES = [".git", ".godot", ".argus", "addons", "node_modules", "dist"];

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
    const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode) throw new Error(result.stderr.toString());
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
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const changes = await collectChanges(f.loaded, project, "HEAD");
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
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  f.write("new.gd", SOURCE.replace("return 1", "return 99"));
  const changes = await collectChanges(f.loaded, project, "HEAD");
  expect(changes.map((target) => target.path)).toEqual(["deleted.gd", "empty.gd", "new.gd"]);
  const addition = JSON.parse(changes.find((target) => target.path === "new.gd")?.source ?? "{}");
  expect(addition.after).toBe(SOURCE);
  expect(addition.diff).toBe(`New file: new.gd\n${SOURCE}`);
  const deletion = JSON.parse(changes.find((target) => target.path === "deleted.gd")?.source ?? "{}");
  expect(deletion.before).toBe(SOURCE);
  expect(deletion.after).toBe("");
  expect(JSON.parse(changes.find((target) => target.path === "empty.gd")?.source ?? "{}").diff).toBe(
    "New file: empty.gd\n",
  );
});
