import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { cli, fixture } from "../helpers";

test("init emits a runnable next command for config paths with spaces and shell punctuation", async () => {
  const f = fixture();
  f.write("value.ts", "export function value() { return 1; }");
  const path = join(f.directory, "reviewer's state $(false)", "config.json");
  const initialised = await cli(f.loaded.root, ["init", "--config", path]);
  expect(initialised.code).toBe(0);
  const command = initialised.stdout.match(/argus check --config .+/)?.[0];
  if (!command) throw new Error("Missing next command");
  const child = Bun.spawn(["sh", "-c", `argus() { "$ARGUS_BUN" "$ARGUS_SOURCE" "$@"; }\n${command} --json`], {
    cwd: f.loaded.root,
    env: {
      ...process.env,
      TYPESAFE_API_KEY: "",
      ARGUS_BUN: process.execPath,
      ARGUS_SOURCE: resolve(import.meta.dir, "../../src/cli.ts"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout).summary).toMatchObject({ files: 1, targets: 1, pending: 1 });
});
