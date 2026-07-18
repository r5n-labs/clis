import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { VersionCommand } from "../../src/commands/version";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import type { StoneJson } from "../../src/domain/Stone";
import type { SisyphusConfig } from "../../src/types";
import { createWorkspaceFixture } from "../helpers/workspace";

type ExecuteCtx = Parameters<VersionCommand["execute"]>[0];
type CtxArgs = Record<string, string | boolean | undefined>;
type CtxPositionals = Record<string, string | undefined>;

function makeCtx(
  config: ConfigManager<SisyphusConfig>,
  args: CtxArgs,
  options: { interactive?: boolean; positionals?: CtxPositionals } = {},
): ExecuteCtx {
  return {
    args: { all: false, dryRun: false, fromCommits: false, yes: false, ...args },
    cli: { name: "SISYPHUS" },
    config,
    interactive: options.interactive ?? true,
    positionals: options.positionals ?? {},
  } as ExecuteCtx;
}

describe("VersionCommand non-interactive flags", () => {
  const originalCwd = process.cwd();
  let root: string;
  let config: ConfigManager<SisyphusConfig>;

  beforeEach(() => {
    root = createWorkspaceFixture([
      { name: "@fixture/foo", private: true },
      { name: "@fixture/bar", private: true },
    ]);
    process.chdir(root);
    config = new ConfigManager<SisyphusConfig>(join(root, ".sisyphus/config.json"), SISYPHUS_DEFAULT_CONFIG);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(root, { force: true, recursive: true });
  });

  function readStones(): StoneJson[] {
    const dir = join(root, ".sisyphus/stones");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(join(dir, file), "utf-8")));
  }

  test("--bump patch --yes --message creates a stone for every package without prompting", async () => {
    const ctx = makeCtx(config, { bump: "patch", message: "release: everything", yes: true });

    await new VersionCommand().execute(ctx);

    const [stone] = readStones();
    expect(stone?.message).toBe("release: everything");
    expect([...(stone?.patch ?? [])].sort()).toEqual(["@fixture/bar", "@fixture/foo"]);
  });

  test("--bump minor --all --filter selects only matching packages", async () => {
    const ctx = makeCtx(config, { all: true, bump: "minor", filter: "foo", message: "feat: foo", yes: true });

    await new VersionCommand().execute(ctx);

    const [stone] = readStones();
    expect(stone?.minor).toEqual(["@fixture/foo"]);
    expect(stone?.patch).toBeUndefined();
  });

  test("per-bump package lists with --message route past the interactive prompts", async () => {
    const ctx = makeCtx(config, { message: "fix: foo", patch: "@fixture/foo", yes: true });

    await new VersionCommand().execute(ctx);

    const [stone] = readStones();
    expect(stone?.message).toBe("fix: foo");
    expect(stone?.patch).toEqual(["@fixture/foo"]);
  });

  test("--dryRun writes no stone", async () => {
    const ctx = makeCtx(config, { bump: "patch", dryRun: true, message: "release: dry", yes: true });

    await new VersionCommand().execute(ctx);

    expect(readStones()).toEqual([]);
  });

  test("missing message fails fast instead of prompting", async () => {
    const ctx = makeCtx(config, { bump: "patch", yes: true });

    await expect(new VersionCommand().execute(ctx)).rejects.toThrow("Message is required in non-interactive mode");
  });

  test("invalid --bump type fails with a clear error", async () => {
    const ctx = makeCtx(config, { all: true, bump: "dependency", message: "release: x", yes: true });

    await expect(new VersionCommand().execute(ctx)).rejects.toThrow('Invalid bump type "dependency"');
  });

  test("--bump without --all or --yes is rejected in non-interactive mode", async () => {
    const ctx = makeCtx(config, { bump: "patch", message: "release: x" }, { interactive: false });

    await expect(new VersionCommand().execute(ctx)).rejects.toThrow("--bump selects every (filtered) package");
  });

  test("--bump without --all or --yes fails fast instead of falling into the interactive prompts", async () => {
    // ctx.interactive is true whenever no positionals are passed (it is not TTY-based),
    // so `sisyphus version --bump patch --message "x"` must still route to the direct path.
    const ctx = makeCtx(config, { bump: "patch", message: "release: x" }, { interactive: true });

    await expect(new VersionCommand().execute(ctx)).rejects.toThrow("--bump selects every (filtered) package");
    expect(readStones()).toEqual([]);
  });

  test("--bump combined with per-bump lists is rejected", async () => {
    const ctx = makeCtx(config, { bump: "patch", message: "release: x", patch: "@fixture/foo", yes: true });

    await expect(new VersionCommand().execute(ctx)).rejects.toThrow(
      "--bump cannot be combined with --major, --minor, or --patch",
    );
  });

  test("message positional still works for the direct path", async () => {
    const ctx = makeCtx(
      config,
      { patch: "@fixture/bar", yes: true },
      { interactive: false, positionals: { message: "fix: bar" } },
    );

    await new VersionCommand().execute(ctx);

    const [stone] = readStones();
    expect(stone?.message).toBe("fix: bar");
    expect(stone?.patch).toEqual(["@fixture/bar"]);
  });
});
