import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cli, fixture } from "../helpers";
import { DOWN, ENTER, ESCAPE, interactive } from "../terminal";

async function changeFixture() {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init", "--preset", "all"])).code).toBe(0);
  for (const args of [
    ["init", "--quiet"],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "--quiet",
      "-m",
      "fixture",
    ],
  ]) {
    const result = Bun.spawnSync(["git", ...args], { cwd: f.loaded.root, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode) throw new Error(result.stderr.toString());
  }
  return f;
}

test("interactive check and run accept a Git base from the root menu", async () => {
  const f = await changeFixture();
  const output = await interactive(
    f.loaded.root,
    ["-i"],
    [
      { prompt: "What would you like to do?", keys: [DOWN, DOWN, ENTER] },
      { prompt: "Git base revision for change questions", keys: ["HEAD", ENTER] },
      { prompt: "What would you like to do?", keys: [DOWN, ENTER], contains: "0 checked" },
      { prompt: "Git base revision for change questions", keys: ["HEAD", ENTER] },
      { prompt: "What would you like to do?", keys: [ESCAPE], contains: "--base HEAD" },
    ],
  );
  expect(output).not.toContain("Change questions require --base");
  expect(output).toContain("Report:");
  expect(existsSync(join(f.loaded.root, ".argus", "cache", "run.lock"))).toBe(false);
});

test.each(["check", "run"])("direct %s cancellation leaves review state untouched", async (command) => {
  const f = await changeFixture();
  await interactive(f.loaded.root, [command], [{ prompt: "Git base revision for change questions", keys: [ESCAPE] }]);
  expect(existsSync(join(f.loaded.root, ".argus", "cache"))).toBe(false);
  expect(existsSync(join(f.loaded.root, ".argus", "reports"))).toBe(false);
  const headless = await cli(f.loaded.root, [command]);
  expect(headless.code).toBe(1);
  expect(headless.stdout + headless.stderr).toContain("Change questions require --base");
});

test("direct run uses the entered base in its report command", async () => {
  const f = await changeFixture();
  const output = await interactive(
    f.loaded.root,
    ["run"],
    [{ prompt: "Git base revision for change questions", keys: ["HEAD", ENTER] }],
  );
  expect(output).toContain("--base HEAD");
  expect(output).not.toContain("Set TYPESAFE_API_KEY");
  expect((await cli(f.loaded.root, ["check", "--base", "HEAD", "--json"])).code).toBe(0);
});
