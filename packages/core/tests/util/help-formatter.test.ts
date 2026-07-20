import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { AbstractCommand } from "../../src/command/abstract-command";
import { args } from "../../src/command/args";
import { HelpFormatter } from "../../src/util/help-formatter";

const cleanupArgs = args({
  days: {
    alias: "d",
    default: 0,
    description: "Override log retention",
    displayDefault: "config or 7 days",
    type: "number",
  },
  dryRun: { alias: "n", default: false, description: "Preview cleanup without deleting", type: "boolean" },
  lines: { alias: "l", default: 100, description: "Number of lines to keep", type: "number" },
});

class CleanupCommand extends AbstractCommand {
  name = "cleanup";
  description = "Remove logs, workspaces, and old runner versions";
  args = cleanupArgs;
}

function createFormatter() {
  const cleanup = new CleanupCommand();
  const globalArgs = args({
    help: { alias: "h", description: "Show help", type: "boolean" },
    interactive: { alias: "i", description: "Open interactive mode", type: "boolean" },
    version: { alias: "v", description: "Show version", type: "boolean" },
  });

  return new HelpFormatter(
    { bin: "hydra", description: "Manage runners.", name: "HYDRA", version: "1.0.0" },
    new Map([[cleanup.name, cleanup]]),
    globalArgs,
  );
}

describe("HelpFormatter", () => {
  test("formats compact global help", () => {
    const output = stripVTControlCharacters(createFormatter().global());

    expect(output).toBe(`HYDRA v1.0.0
Manage runners.

Usage:
  hydra [command] [options]

Commands:
  cleanup  Remove logs, workspaces, and old runner versions

Options:
  -h, --help         Show help
  -i, --interactive  Open interactive mode
  -v, --version      Show version

Run hydra <command> --help for command details.`);
  });

  test("formats public option names, values, and meaningful defaults", () => {
    const command = new CleanupCommand();
    const output = stripVTControlCharacters(createFormatter().command(command));

    expect(output).toBe(`hydra cleanup
Remove logs, workspaces, and old runner versions

Usage:
  hydra cleanup [options]

Options:
  -d, --days <number>   Override log retention (default: config or 7 days)
  -n, --dry-run         Preview cleanup without deleting
  -l, --lines <number>  Number of lines to keep (default: 100)`);
  });

  test("keeps descriptions and defaults high contrast", () => {
    const formatterUrl = new URL("../../src/util/help-formatter.ts", import.meta.url).href;
    const script = `
      import { HelpFormatter } from ${JSON.stringify(formatterUrl)};
      const command = {
        args: { lines: { default: 100, description: "Number of lines", type: "number" } },
        description: "Readable description",
        getSubcommands: () => [],
        hasSubcommands: () => false,
        name: "logs",
        positionals: {},
        prompts: false,
      };
      console.log(new HelpFormatter({ bin: "hydra", name: "HYDRA" }, new Map(), {}).command(command));
    `;
    const { NO_COLOR: _, ...env } = process.env;
    const result = Bun.spawnSync([process.execPath, "--eval", script], { env: { ...env, FORCE_COLOR: "1" } });
    const output = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(output).not.toContain("\x1b[97mReadable description");
    expect(output).not.toContain("\x1b[94m100");
    expect(output).toContain("(default: \x1b[1m100\x1b[0m)");
  });
});
