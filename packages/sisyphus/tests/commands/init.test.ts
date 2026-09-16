import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const INIT_PATH = resolve(PACKAGE_ROOT, "src/commands/init.ts");
const CONSTANTS_PATH = resolve(PACKAGE_ROOT, "src/constants.ts");
const PROMPTS_PATH = Bun.resolveSync("@clack/prompts", PACKAGE_ROOT);

function completeInitForm(configureCommit: boolean) {
  const source = `
    import { mock } from "bun:test";
    const original = { ...await import(${JSON.stringify(PROMPTS_PATH)}) };
    const answers = {
      "Commit author": "Release Maintainer",
      "Commit author email": "maintainer@example.com",
      "Commit message": "release: <packageName@version>",
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
    const { SISYPHUS_DEFAULT_CONFIG } = await import(${JSON.stringify(CONSTANTS_PATH)});
    const command = new InitCommand();
    const values = await Reflect.get(command, "runInitForm").call(command, SISYPHUS_DEFAULT_CONFIG);
    console.log(JSON.stringify({ shown, values }));
  `;
  const child = Bun.spawnSync([process.execPath, "--eval", source], { stderr: "pipe", stdout: "pipe" });
  expect(child.exitCode).toBe(0);
  return JSON.parse(new TextDecoder().decode(child.stdout)) as {
    shown: string[];
    values: { commitAuthor?: string; commitEmail?: string; commitMessage?: string };
  };
}

describe("Sisyphus initialisation prompts", () => {
  test("collects commit details after the user chooses to configure them", () => {
    const result = completeInitForm(true);
    expect(result.values).toMatchObject({
      commitAuthor: "Release Maintainer",
      commitEmail: "maintainer@example.com",
      commitMessage: "release: <packageName@version>",
    });
  });

  test("skips commit details when the user declines commit configuration", () => {
    const result = completeInitForm(false);
    expect(result.values.commitAuthor).toBeUndefined();
    expect(result.values.commitEmail).toBeUndefined();
    expect(result.values.commitMessage).toBeUndefined();
    expect(result.shown).not.toContain("Commit author");
  });
});
