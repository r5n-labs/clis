import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CHANGELOG_FILE,
  type Fixture,
  gitText,
  makeConfig,
  PACKAGE_FILE,
  PACKAGE_NAME,
  STONE_FILE,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";

const CLI_PATH = resolve(import.meta.dir, "../../src/cli.ts");
const ROLL_PATH = resolve(import.meta.dir, "../../src/commands/roll.ts");
const HELPERS_PATH = resolve(import.meta.dir, "../helpers/release-orchestrator.ts");
const PROMPTS_PATH = Bun.resolveSync("@clack/prompts", resolve(import.meta.dir, "../.."));
const CONFIG_FILE = ".sisyphus/config.json";
const SECOND_STONE = ".sisyphus/stones/0002-testtest.json";
const ORIGINAL_HISTORY = "# Changelog\r\n\r\nOlder release: café  \r\n";

describe("command mutation and prompt lifecycle", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setupReleaseFixture(true);
  });

  afterEach(() => {
    rmSync(fixture.root, { force: true, recursive: true });
    rmSync(fixture.remote, { force: true, recursive: true });
  });

  async function run(args: string[], source?: string) {
    const child = Bun.spawn([process.execPath, ...(source ? ["--eval", source] : [CLI_PATH, ...args])], {
      cwd: fixture.root,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stderr, stdout };
  }

  function snapshot(files: string[]) {
    return files.map((file) => readFileSync(join(fixture.root, file)));
  }

  function stoneFiles() {
    return readdirSync(join(fixture.root, ".sisyphus/stones")).sort();
  }

  function addSecondStone() {
    writeFileSync(
      join(fixture.root, SECOND_STONE),
      JSON.stringify({ id: "0002-testtest", message: "second", minor: [PACKAGE_NAME] }),
    );
  }

  test.each(["delete", "merge"])("stone %s rejects unsupported preview options before mutation", async (command) => {
    addSecondStone();
    const files = [STONE_FILE, SECOND_STONE, CONFIG_FILE];
    const original = snapshot(files);
    const args =
      command === "delete"
        ? ["stone", "delete", "0001-testtest", "--dry-run"]
        : ["stone", "merge", "0001-testtest", "0002-testtest", "-m", "combined", "--delete", "--dry-run"];
    const result = await run(args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("Unknown option: --dry-run");
    expect(snapshot(files)).toEqual(original);
    expect(stoneFiles()).toEqual(["0001-testtest.json", "0002-testtest.json"]);
  });

  test.each(["delete", "merge"])("stone %s still supports explicit valid mutation", async (command) => {
    addSecondStone();
    const second = readFileSync(join(fixture.root, SECOND_STONE));
    const args =
      command === "delete"
        ? ["stone", "delete", "0001-testtest"]
        : ["stone", "merge", "0001-testtest", "0002-testtest", "-m", "combined", "-d"];
    const result = await run(args);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(fixture.root, STONE_FILE))).toBe(false);
    if (command === "delete") {
      expect(stoneFiles()).toEqual(["0002-testtest.json"]);
      expect(readFileSync(join(fixture.root, SECOND_STONE))).toEqual(second);
      return;
    }
    expect(existsSync(join(fixture.root, SECOND_STONE))).toBe(false);
    const mergedFiles = stoneFiles();
    expect(mergedFiles).toHaveLength(1);
    const merged = JSON.parse(readFileSync(join(fixture.root, ".sisyphus/stones", mergedFiles[0] ?? ""), "utf8"));
    expect(merged.message).toBe("combined");
    expect(merged.minor).toEqual([PACKAGE_NAME]);
  });

  test.each(["consent", "dry-run", "yes"])(
    "migration completes a deterministic non-interactive %s path",
    async (mode) => {
      mkdirSync(join(fixture.root, ".changeset"));
      const changeset = join(fixture.root, ".changeset/fixture.md");
      const changesetConfig = join(fixture.root, ".changeset/config.json");
      writeFileSync(changeset, `---\n"${PACKAGE_NAME}": patch\n---\nMigration fixture\n`);
      writeFileSync(changesetConfig, JSON.stringify({ changelog: false, ignore: ["ignored-package"] }));
      const inputs = [readFileSync(changeset), readFileSync(changesetConfig)];
      const original = snapshot([STONE_FILE, CONFIG_FILE, PACKAGE_FILE]);
      const result = await run(["migrate", ...(mode === "consent" ? [] : [`--${mode}`])]);
      expect(result.exitCode).toBe(mode === "consent" ? 1 : 0);
      expect([readFileSync(changeset), readFileSync(changesetConfig)]).toEqual(inputs);
      const output = result.stdout + result.stderr;
      if (mode !== "yes") {
        expect(snapshot([STONE_FILE, CONFIG_FILE, PACKAGE_FILE])).toEqual(original);
        expect(stoneFiles()).toEqual(["0001-testtest.json"]);
        expect(output).toContain(mode === "consent" ? "--yes" : "No changes made");
        expect(output).not.toContain("Migrate 1 changeset(s) to stones?");
        return;
      }
      expect(output).toContain("Migration complete");
      expect(output).toContain("sis roll --preview");
      const migratedName = stoneFiles().find((name) => name !== "0001-testtest.json");
      expect(migratedName).toBeDefined();
      const migrated = JSON.parse(readFileSync(join(fixture.root, ".sisyphus/stones", migratedName ?? ""), "utf8"));
      expect(migrated.message).toBe("Migration fixture");
      expect(migrated.patch).toEqual([PACKAGE_NAME]);
      const config = JSON.parse(readFileSync(join(fixture.root, CONFIG_FILE), "utf8"));
      expect(config.changelog.generate).toBe(false);
      expect(config.ignore).toEqual(["ignored-package"]);
    },
  );

  async function preparePreview() {
    const config = makeConfig(fixture.root);
    config.set("changelog", { ...config.get("changelog"), root: true });
    writeFileSync(join(fixture.root, CHANGELOG_FILE), ORIGINAL_HISTORY);
    return {
      bytes: snapshot([CHANGELOG_FILE, PACKAGE_FILE, STONE_FILE, CONFIG_FILE]),
      head: await gitText(fixture.root, ["rev-parse", "HEAD"]),
      status: await gitText(fixture.root, ["status", "--porcelain"]),
    };
  }

  async function expectRestored(before: Awaited<ReturnType<typeof preparePreview>>) {
    expect(snapshot([CHANGELOG_FILE, PACKAGE_FILE, STONE_FILE, CONFIG_FILE])).toEqual(before.bytes);
    expect(existsSync(join(fixture.root, "CHANGELOG.md"))).toBe(false);
    expect(await gitText(fixture.root, ["status", "--porcelain"])).toBe(before.status);
    expect(await gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(before.head);
    expect(await gitText(fixture.root, ["tag", "--list"])).toBe("");
    expect(existsSync(join(fixture.root, ".git/sisyphus/release/active.json"))).toBe(false);
  }

  test.each([{ flags: [] }, { flags: ["--yes"] }, { flags: ["--json"] }])(
    "non-interactive preview %j restores original bytes and removes new history",
    async ({ flags }: { flags: readonly string[] }) => {
      const before = await preparePreview();
      const result = await run(["roll", "--preview", ...flags]);
      expect(result.exitCode).toBe(0);
      await expectRestored(before);
      if (flags.includes("--json")) {
        expect(JSON.parse(result.stdout)).toMatchObject({ mode: "preview", status: "previewed" });
      } else {
        expect(result.stdout).toContain("Changes reverted");
        expect(result.stdout).not.toContain("Revert changes?");
      }
    },
  );

  test.each(["keep", "revert", "cancel", "yes"])(
    "interactive preview honours %s without losing original history",
    async (decision) => {
      const before = await preparePreview();
      const source = `
      import { mock } from "bun:test";
      const original = { ...await import(${JSON.stringify(PROMPTS_PATH)}) };
      let prompts = 0;
      mock.module(${JSON.stringify(PROMPTS_PATH)}, () => ({
        ...original,
        confirm: async () => {
          prompts++;
          if (${JSON.stringify(decision)} === "yes") throw new Error("Unexpected confirmation");
          if (${JSON.stringify(decision)} === "cancel") {
            return original.confirm({ message: "Revert changes?", signal: AbortSignal.abort() });
          }
          return ${JSON.stringify(decision)} === "revert";
        },
      }));
      Object.defineProperty(process.stdout, "isTTY", { value: true });
      const { RollCommand } = await import(${JSON.stringify(ROLL_PATH)});
      const { makeConfig } = await import(${JSON.stringify(HELPERS_PATH)});
      let outcome = "completed";
      try {
        await new RollCommand().execute({
          args: { preview: true, yes: ${decision === "yes"} }, config: makeConfig(process.cwd()),
          cli: { name: "SISYPHUS" }, interactive: false, positionals: {},
        });
      } catch (error) {
        if (error.name !== "Error" || error.message !== "Operation cancelled") throw error;
        outcome = "cancelled";
      }
      process.stdout.write("RESULT:" + JSON.stringify({ prompts, outcome }) + "\\n");
    `;
      const result = await run([], source);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        `RESULT:${JSON.stringify({ prompts: decision === "yes" ? 0 : 1, outcome: decision === "cancel" ? "cancelled" : "completed" })}`,
      );
      if (decision !== "keep") {
        await expectRestored(before);
        return;
      }
      expect(readFileSync(join(fixture.root, CHANGELOG_FILE), "utf8")).toContain("1.0.1");
      expect(readFileSync(join(fixture.root, "CHANGELOG.md"), "utf8")).toContain("1.0.1");
      expect(snapshot([PACKAGE_FILE, STONE_FILE, CONFIG_FILE])).toEqual(before.bytes.slice(1));
      expect(await gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(before.head);
    },
  );
});
