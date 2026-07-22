import { describe, expect, test } from "bun:test";

const ABSTRACT_CLI_PATH = `${import.meta.dir}/../src/abstract-cli.ts`;
const COMMAND_PATH = `${import.meta.dir}/../src/command/index.ts`;
const CONFIG_MANAGER_PATH = `${import.meta.dir}/../src/config-manager.ts`;
const EXIT_PATH = `${import.meta.dir}/../src/exit.ts`;
const CUSTOM_EXIT_CODE = 7;

type CliResult = { exitCode: number; output: string };

function runFailingCli(exitCode?: number): CliResult {
  const exitArguments = exitCode === undefined ? '"command failed"' : `"command failed", undefined, ${exitCode}`;
  const source = `
    import { AbstractCLI } from ${JSON.stringify(ABSTRACT_CLI_PATH)};
    import { AbstractCommand } from ${JSON.stringify(COMMAND_PATH)};
    import type { ConfigManager } from ${JSON.stringify(CONFIG_MANAGER_PATH)};
    import { Exit } from ${JSON.stringify(EXIT_PATH)};

    class FailingCommand extends AbstractCommand {
      name = "fail";
      description = "Fail the command";

      async execute(): Promise<void> {
        throw new Exit(${exitArguments});
      }
    }

    class TestCLI extends AbstractCLI {
      init(): void {
        this.registerCommands([new FailingCommand()]);
      }
    }

    const cli = new TestCLI({} as ConfigManager<object>, { bin: "test-cli", name: "Test CLI" });
    await cli.run(["fail"]);
  `;
  const result = Bun.spawnSync({ cmd: [process.execPath, "--eval", source], stderr: "pipe", stdout: "pipe" });
  const decoder = new TextDecoder();

  return { exitCode: result.exitCode, output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}` };
}

describe("AbstractCLI", () => {
  test("exits with status 1 when a direct command throws Exit", () => {
    const result = runFailingCli();

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("command failed");
  });

  test("uses the explicit status from Exit", () => {
    const result = runFailingCli(CUSTOM_EXIT_CODE);

    expect(result.exitCode).toBe(CUSTOM_EXIT_CODE);
    expect(result.output).toContain("command failed");
  });
});
