import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SISYPHUS_DEFAULT_CONFIG } from "../../src/constants";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const INIT_PATH = resolve(PACKAGE_ROOT, "src/commands/init.ts");
const CONFIG_HELPER_PATH = resolve(import.meta.dir, "../helpers/release-orchestrator.ts");
const PROMPTS_PATH = Bun.resolveSync("@clack/prompts", PACKAGE_ROOT);
const SHOWN_MARKER = "SHOWN:";
const COMMIT_ANSWERS = {
  author: "Release Maintainer",
  email: "maintainer@example.com",
  message: "release: <packageName@version>",
};

describe("Sisyphus initialisation prompts", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sisyphus-init-"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  function initialiseInteractively(configureCommit: boolean): string[] {
    const source = `
      import { mock } from "bun:test";
      const original = { ...await import(${JSON.stringify(PROMPTS_PATH)}) };
      const answers = {
        "Commit author": ${JSON.stringify(COMMIT_ANSWERS.author)},
        "Commit author email": ${JSON.stringify(COMMIT_ANSWERS.email)},
        "Commit message": ${JSON.stringify(COMMIT_ANSWERS.message)},
      };
      const shown = [];
      mock.module(${JSON.stringify(PROMPTS_PATH)}, () => ({
        ...original,
        confirm: async ({ message }) => message.startsWith("Configure commit") && ${configureCommit},
        log: { ...original.log, info: () => {} },
        text: async ({ message, initialValue }) => {
          shown.push(message);
          return answers[message] ?? initialValue ?? "";
        },
      }));
      const { InitCommand } = await import(${JSON.stringify(INIT_PATH)});
      const { makeConfig } = await import(${JSON.stringify(CONFIG_HELPER_PATH)});
      await new InitCommand().execute({
        args: { default: false, force: false }, cli: { name: "SISYPHUS" },
        config: makeConfig(process.cwd()), interactive: true, positionals: {},
      });
      process.stdout.write(${JSON.stringify(SHOWN_MARKER)} + JSON.stringify(shown) + "\\n");
    `;
    const child = Bun.spawnSync([process.execPath, "--eval", source], { cwd: root, stderr: "pipe", stdout: "pipe" });
    const shown = child.stdout
      .toString()
      .split("\n")
      .find((line) => line.startsWith(SHOWN_MARKER));

    if (child.exitCode !== 0 || !shown) {
      throw new Error(`init form failed (${child.exitCode}): ${child.stderr.toString().trim()}`);
    }
    return JSON.parse(shown.slice(SHOWN_MARKER.length));
  }

  function savedCommit() {
    return JSON.parse(readFileSync(join(root, ".sisyphus/config.json"), "utf8")).commit;
  }

  test("saves commit details after the user chooses to configure them", () => {
    initialiseInteractively(true);

    expect(savedCommit()).toEqual(COMMIT_ANSWERS);
  });

  test("keeps the default commit details when the user declines commit configuration", () => {
    const shown = initialiseInteractively(false);

    expect(shown).not.toContain("Commit author");
    expect(savedCommit()).toEqual(SISYPHUS_DEFAULT_CONFIG.commit);
  });
});
