import { describe, expect, test } from "bun:test";
import { AbstractCommand, args, type CommandContext, positionals } from "../src/command";
import { CommandRouter } from "../src/command-router";
import type { ConfigManager } from "../src/config-manager";
import { Exit } from "../src/exit";
import type { CliMetadata } from "../src/types";

class ChildArgsCommand extends AbstractCommand {
  name = "run";
  description = "Run child command";
  args = args({});
  positionals = positionals({ command: { description: "Command to run", required: true, variadic: true } });
  capturedCommand: string[] | undefined;

  async execute(ctx: CommandContext): Promise<void> {
    this.capturedCommand = ctx.positionals.command as string[];
  }
}

function env() {
  return {
    cli: { name: "test" } satisfies CliMetadata,
    config: {} as ConfigManager<object>,
    formatHelp: () => "help text",
  };
}

describe("CommandRouter", () => {
  test("runs a command with supplied flags without prompting when stdout is not a terminal", async () => {
    let interactive: boolean | undefined;
    class PromptCommand extends AbstractCommand {
      name = "configure";
      description = "Configure a command";
      prompts = true;
      args = args({ name: { type: "string" } });
      async execute(ctx: CommandContext): Promise<void> {
        interactive = ctx.interactive;
      }
    }
    const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    try {
      await new CommandRouter(new PromptCommand(), env()).route(["--name", "automated"], false);
      expect(interactive).toBe(false);
    } finally {
      if (original) Object.defineProperty(process.stdout, "isTTY", original);
      else Reflect.deleteProperty(process.stdout, "isTTY");
    }
  });

  test("rejects explicit interactive routing when stdout is not a terminal", async () => {
    const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    try {
      const command = new ChildArgsCommand();
      await expect(new CommandRouter(command, env()).route([], true)).rejects.toThrow(Exit);
      expect(command.capturedCommand).toBeUndefined();
    } finally {
      if (original) Object.defineProperty(process.stdout, "isTTY", original);
      else Reflect.deleteProperty(process.stdout, "isTTY");
    }
  });

  test("passes child help flags after the delimiter to the command", async () => {
    const command = new ChildArgsCommand();

    await new CommandRouter(command, env()).route(["--", "bun", "--help"], false);

    expect(command.capturedCommand).toEqual(["bun", "--help"]);
  });

  test("still handles help flags before the delimiter as command help", async () => {
    const command = new ChildArgsCommand();
    const logs = captureConsoleLog(() => new CommandRouter(command, env()).route(["--help"], false));

    await logs.result;

    expect(logs.output()).toBe("help text\n");
    expect(command.capturedCommand).toBeUndefined();
  });
});

function captureConsoleLog(run: () => Promise<void>) {
  let output = "";
  const originalLog = console.log;

  console.log = (...values: unknown[]) => {
    output += `${values.join(" ")}\n`;
  };

  const result = run().finally(() => {
    console.log = originalLog;
  });

  return { output: () => output, result };
}
