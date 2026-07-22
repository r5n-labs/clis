import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ConfigManager } from "@r5n/cli-core";
import { VersionCommand } from "../../src/commands/version";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";
import type { Package, StoneData } from "../../src/domain";
import type { StoneJson } from "../../src/domain/Stone";
import type { SisyphusConfig } from "../../src/types";
import { createWorkspaceFixture } from "../helpers/workspace";

type ExecuteCtx = Parameters<VersionCommand["execute"]>[0];
type CtxArgs = Record<string, string | boolean | undefined>;
type CtxPositionals = Record<string, string | undefined>;
type PackageSelection = { major: string[]; minor: string[]; patch: string[] };
type InteractiveHarness = {
  createStone: (ctx: ExecuteCtx, data: StoneData, packages: Map<string, Package>) => Promise<void>;
  promptDescription: () => Promise<string | undefined>;
  selectPackagesInteractive: (
    packages: Map<string, Package>,
    packageNames: readonly string[],
  ) => Promise<PackageSelection>;
};

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

  test("trims --tag for persisted stones and dry-run previews", async () => {
    const persistedCtx = makeCtx(config, {
      message: "release: persisted tag",
      patch: "@fixture/foo",
      tag: " beta ",
      yes: true,
    });

    await new VersionCommand().execute(persistedCtx);

    const [stone] = readStones();
    expect(stone?.tag).toBe("beta");

    const cliPath = join(import.meta.dir, "../../src/cli.ts");
    const subprocess = Bun.spawn(
      [
        process.execPath,
        cliPath,
        "version",
        "--patch",
        "@fixture/bar",
        "--message",
        "release: dry-run tag",
        "--yes",
        "--dry-run",
        "--tag",
        " rc1 ",
      ],
      { cwd: root, stderr: "pipe", stdin: "ignore", stdout: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(`${stdout}\n${stderr}`).toContain("1.0.0-rc1.1");
    expect(readStones()).toHaveLength(1);
  });

  test("rejects invalid explicit tags before persisted and dry-run execution", async () => {
    const cases: Array<[string, string]> = [
      ["", "--tag cannot be empty"],
      ["   ", "--tag cannot be empty"],
      ["beta rc", "--tag must be a supported prerelease identifier"],
      ["beta.rc", "--tag must be a supported prerelease identifier"],
      ["beta_rc", "--tag must be a supported prerelease identifier"],
      ["beta-foo", "--tag must be a supported prerelease identifier"],
      ["01", "--tag must be a supported prerelease identifier"],
    ];

    for (const dryRun of [false, true]) {
      for (const [tag, message] of cases) {
        const ctx = makeCtx(config, { dryRun, message: "release: invalid tag", patch: "@fixture/foo", tag, yes: true });

        await expect(new VersionCommand().execute(ctx)).rejects.toThrow(message);
      }
    }

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

  test("--all without --bump fails instead of entering interactive selection", async () => {
    const ctx = makeCtx(config, { all: true });

    await expect(new VersionCommand().execute(ctx)).rejects.toThrow("--all requires a valid --bump");
    expect(readStones()).toEqual([]);
  });

  test("--all without --bump exits nonzero with closed stdin", async () => {
    const cliPath = join(import.meta.dir, "../../src/cli.ts");
    const subprocess = Bun.spawn([process.execPath, cliPath, "version", "--all", "--message", "release: x"], {
      cwd: root,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(`${stdout}\n${stderr}`).toContain("--all requires a valid --bump");
  });

  test("supplied empty bump and package lists fail before mode dispatch", async () => {
    const cases: Array<[CtxArgs, string]> = [
      [{ bump: "   ", message: "release: x" }, "--bump cannot be empty"],
      [{ message: "release: x", patch: "   " }, "--patch must contain one or more non-empty package names"],
      [{ message: "release: x", minor: "@fixture/foo,  " }, "--minor must contain one or more non-empty package names"],
    ];

    for (const [args, message] of cases) {
      await expect(new VersionCommand().execute(makeCtx(config, args))).rejects.toThrow(message);
    }
  });

  test("deduplicates repeated packages within a bump list", async () => {
    const ctx = makeCtx(config, { message: "fix: foo", patch: " @fixture/foo, @fixture/foo ", yes: true });

    await new VersionCommand().execute(ctx);

    const [stone] = readStones();
    expect(stone?.patch).toEqual(["@fixture/foo"]);
  });

  test("rejects packages assigned to more than one bump group", async () => {
    const ctx = makeCtx(config, { major: "@fixture/foo", message: "release: foo", patch: "@fixture/foo", yes: true });

    await expect(new VersionCommand().execute(ctx)).rejects.toThrow(
      'Package "@fixture/foo" cannot be assigned to both --major and --patch',
    );
    expect(readStones()).toEqual([]);
  });

  test("rejects --from-commits with manual selections, --all, or messages", async () => {
    const conflictingArgs: CtxArgs[] = [
      { bump: "patch", fromCommits: true },
      { all: true, fromCommits: true },
      { fromCommits: true, major: "@fixture/foo" },
      { fromCommits: true, message: "release: x" },
    ];

    for (const args of conflictingArgs) {
      await expect(new VersionCommand().execute(makeCtx(config, args))).rejects.toThrow(
        "--from-commits cannot be combined",
      );
    }

    const positionalMessageCtx = makeCtx(
      config,
      { fromCommits: true },
      { interactive: false, positionals: { message: "release: x" } },
    );
    await expect(new VersionCommand().execute(positionalMessageCtx)).rejects.toThrow(
      "--from-commits cannot be combined",
    );
  });

  test("allows --from-commits with filter, normalized tag, dryRun, and yes", async () => {
    const ctx = makeCtx(config, { dryRun: true, filter: "foo", fromCommits: true, tag: " beta ", yes: true });

    await expect(new VersionCommand().execute(ctx)).resolves.toBeUndefined();
    expect(readStones()).toEqual([]);
  });

  test("trims a single message source and optional description", async () => {
    const ctx = makeCtx(
      config,
      { patch: "@fixture/foo", yes: true },
      { interactive: false, positionals: { description: "  More detail  ", message: "  fix: foo  " } },
    );

    await new VersionCommand().execute(ctx);

    const [stone] = readStones();
    expect(stone?.message).toBe("fix: foo");
    expect(stone?.description).toBe("More detail");
  });

  test("normalizes a whitespace-only optional description to undefined", async () => {
    const ctx = makeCtx(
      config,
      { patch: "@fixture/foo", yes: true },
      { interactive: false, positionals: { description: "   ", message: "fix: foo" } },
    );

    await new VersionCommand().execute(ctx);

    const [stone] = readStones();
    expect(stone?.description).toBeUndefined();
  });

  test("rejects whitespace messages and simultaneous positional and flag messages", async () => {
    await expect(
      new VersionCommand().execute(makeCtx(config, { message: "   ", patch: "@fixture/foo", yes: true })),
    ).rejects.toThrow("Message cannot be empty");

    const duplicateMessageCtx = makeCtx(
      config,
      { message: "flag message", patch: "@fixture/foo", yes: true },
      { interactive: false, positionals: { message: "positional message" } },
    );
    await expect(new VersionCommand().execute(duplicateMessageCtx)).rejects.toThrow(
      "Message cannot be provided both positionally and with --message",
    );
  });

  test("filter constrains explicit per-package selections", async () => {
    const ctx = makeCtx(config, { filter: "foo", message: "fix: bar", patch: "@fixture/bar", yes: true });

    await expect(new VersionCommand().execute(ctx)).rejects.toThrow(
      'Packages do not match --filter "foo": @fixture/bar',
    );
    expect(readStones()).toEqual([]);
  });

  test("empty and mismatched filters fail", async () => {
    const emptyFilterCtx = makeCtx(config, {
      all: true,
      bump: "patch",
      filter: "   ",
      message: "release: x",
      yes: true,
    });
    await expect(new VersionCommand().execute(emptyFilterCtx)).rejects.toThrow("--filter cannot be empty");

    const mismatchCtx = makeCtx(config, {
      all: true,
      bump: "patch",
      filter: "missing",
      message: "release: x",
      yes: true,
    });
    await expect(new VersionCommand().execute(mismatchCtx)).rejects.toThrow("No packages found matching the criteria");
  });

  test("plain interactive mode applies filter choices and preserves tag", async () => {
    const command = new VersionCommand();
    const harness = command as unknown as InteractiveHarness;
    let availablePackageNames: readonly string[] = [];
    let stoneData: StoneData | undefined;

    harness.selectPackagesInteractive = async (_packages, packageNames) => {
      availablePackageNames = packageNames;
      return { major: [], minor: [], patch: [...packageNames] };
    };
    harness.promptDescription = async () => undefined;
    harness.createStone = async (_ctx, data, _packages) => {
      stoneData = data;
    };

    await command.execute(makeCtx(config, { filter: "foo", message: "fix: foo", tag: " beta " }));

    expect(availablePackageNames).toEqual(["@fixture/foo"]);
    expect(stoneData).toMatchObject({ message: "fix: foo", patch: ["@fixture/foo"], tag: "beta" });
  });
});
