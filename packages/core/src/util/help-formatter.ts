import type { AbstractCommand, ArgDefinition, PositionalDefinition } from "../command";
import { color } from "./color";
import { toKebabCase } from "./mri-utils";

export type HelpMetadata = { name: string; bin: string; version?: string; description?: string };

const plain = (text: string) => text;

const c = {
  arg: color.magenta,
  cmd: color.cyan,
  default: color.bold,
  desc: plain,
  flag: color.green,
  header: (s: string) => color.bold(color.yellow(s)),
  hint: color.dim,
  name: (s: string) => color.bold(color.cyan(s)),
  placeholder: color.magenta,
};

export class HelpFormatter {
  constructor(
    private metadata: HelpMetadata,
    private commands: Map<string, AbstractCommand<any>>,
    private globalArgs: Record<string, ArgDefinition>,
  ) {}

  version(): string {
    return `${c.name(this.metadata.name)} ${c.hint(this.metadata.version ?? "0.0.0")}`;
  }

  global(): string {
    const lines: string[] = [];
    const { name, bin, version, description } = this.metadata;

    lines.push(`${c.name(name)}${version ? ` ${c.hint(`v${version}`)}` : ""}`);
    if (description) lines.push(c.desc(description));
    lines.push("");

    lines.push(c.header("Usage:"));
    lines.push(`  ${c.cmd(bin)} ${c.placeholder("[command]")} ${c.placeholder("[options]")}`);
    lines.push("");

    lines.push(c.header("Commands:"));
    const cmdRows = Array.from(this.commands.values()).map(
      (cmd) => [`  ${c.cmd(cmd.name)}`, c.desc(cmd.description)] as [string, string],
    );
    lines.push(...this.formatColumns(cmdRows));
    lines.push("");

    lines.push(c.header("Options:"));
    lines.push(...this.formatArgDefs(this.globalArgs));
    lines.push("");

    lines.push(`${c.hint("Run")} ${c.cmd(`${bin} <command> --help`)} ${c.hint("for command details.")}`);

    return lines.join("\n").trimEnd();
  }

  command(cmd: AbstractCommand<any>, prefix?: string): string {
    const lines: string[] = [];
    const cliName = prefix ?? this.metadata.bin;
    const commandName = `${cliName} ${cmd.name}`;
    const cmdPath = `${c.cmd(cliName)} ${c.cmd(cmd.name)}`;

    lines.push(c.name(commandName));
    lines.push(c.desc(cmd.description));
    lines.push("");

    lines.push(c.header("Usage:"));
    const positionalUsage = this.formatPositionalUsage(cmd.positionals);
    if (cmd.hasSubcommands()) {
      lines.push(`  ${cmdPath} ${c.placeholder("<subcommand>")} ${c.placeholder("[options]")}`);
    } else {
      const parts = [cmdPath];
      if (positionalUsage) parts.push(positionalUsage);
      parts.push(c.placeholder("[options]"));
      lines.push(`  ${parts.join(" ")}`);
    }

    if (cmd.prompts && Object.keys(cmd.positionals).length > 0) {
      lines.push(`  ${c.hint("Omit positional arguments to run interactively.")}`);
    }
    lines.push("");

    if (cmd.hasSubcommands()) {
      lines.push(c.header("Subcommands:"));
      const subRows = cmd
        .getSubcommands()
        .map((sub) => [`  ${c.cmd(sub.name)}`, c.desc(sub.description)] as [string, string]);
      lines.push(...this.formatColumns(subRows));
      lines.push("");
    }

    const positionalEntries = Object.entries(cmd.positionals);
    if (positionalEntries.length > 0) {
      lines.push(c.header("Arguments:"));
      lines.push(...this.formatPositionalDefs(cmd.positionals));
      lines.push("");
    }

    const argEntries = Object.entries(cmd.args);
    if (argEntries.length > 0) {
      lines.push(c.header("Options:"));
      lines.push(...this.formatArgDefs(cmd.args));
    }

    return lines.join("\n").trimEnd();
  }

  private formatPositionalUsage(positionals: Record<string, PositionalDefinition>): string {
    return Object.entries(positionals)
      .map(([name, def]) => {
        const displayName = def.variadic ? `${name}...` : name;
        return def.required ? c.arg(`<${displayName}>`) : c.arg(`[${displayName}]`);
      })
      .join(" ");
  }

  private formatPositionalDefs(positionals: Record<string, PositionalDefinition>): string[] {
    const rows: [string, string][] = Object.entries(positionals).map(([name, def]) => {
      const displayName = def.variadic ? `${name}...` : name;
      const desc = c.desc(def.description ?? "");
      const required = def.required ? "" : c.hint(" (optional)");
      return [`  ${c.arg(displayName)}`, `${desc}${required}`];
    });

    return this.formatColumns(rows);
  }

  private formatArgDefs(argDefs: Record<string, ArgDefinition>): string[] {
    const rows: [string, string][] = [];

    for (const [key, def] of Object.entries(argDefs)) {
      const alias = def.alias ? `${c.flag(`-${def.alias}`)}, ` : "    ";
      const value =
        def.type === "boolean" ? "" : ` ${c.placeholder(`<${def.type === "number" ? "number" : "value"}>`)}`;
      const flag = `${alias}${c.flag(`--${toKebabCase(key)}`)}${value}`;
      const desc = c.desc(def.description ?? "");
      const formattedDefault = this.formatDefault(def);
      const defaultVal = formattedDefault === undefined ? "" : ` (default: ${c.default(formattedDefault)})`;
      rows.push([`  ${flag}`, `${desc}${defaultVal}`]);
    }

    return this.formatColumns(rows);
  }

  private formatDefault(def: ArgDefinition): string | undefined {
    if (typeof def.displayDefault === "string") return def.displayDefault;
    if (def.default === undefined) return undefined;
    if (def.type === "boolean" && def.default === false) return undefined;
    if (def.type === "string") return `"${def.default}"`;
    return String(def.default);
  }

  private formatColumns(rows: [string, string][]): string[] {
    if (rows.length === 0) return [];

    const maxLeft = Math.max(...rows.map(([left]) => this.stripAnsi(left).length));
    const gap = 2;

    return rows.map(([left, right]) => {
      const padding = maxLeft - this.stripAnsi(left).length + gap;
      return `${left}${" ".repeat(padding)}${right}`;
    });
  }

  private stripAnsi(str: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: it's fine
    return str.replace(/\x1b\[[0-9;]*m/g, "");
  }
}
