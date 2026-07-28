import mri from "mri";
import type { ArgDefinition, ArgValue, PositionalDefinition } from "../command";
import { Exit } from "../exit";

export type MriOptions = {
  alias: Record<string, string>;
  boolean: string[];
  string: string[];
  default: Record<string, ArgValue>;
};

export type ParsedArgs = Record<string, ArgValue>;

export type GlobalParseResult = { command: string | undefined; flags: ParsedArgs; restArgs: string[] };

export type CommandParseResult = { args: ParsedArgs; rawPositionals: string[] };

const SHORT_FLAG_LENGTH = 1;

export function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

export function buildMriOptions(argDefs: Record<string, ArgDefinition>): MriOptions {
  const opts: MriOptions = { alias: {}, boolean: [], default: {}, string: [] };

  for (const [key, def] of Object.entries(argDefs)) {
    if (def.type === "boolean") opts.boolean.push(key);
    else opts.string.push(key);

    if (def.alias) opts.alias[def.alias] = key;

    const kebab = toKebabCase(key);
    if (kebab !== key) {
      opts.alias[kebab] = key;
    }

    if (def.default !== undefined) opts.default[key] = def.default;
  }

  return opts;
}

function resolveFlagToken(key: string, argDefs: Record<string, ArgDefinition>): string {
  if (key in argDefs) return `--${toKebabCase(key)}`;

  const canonical = Object.entries(argDefs).find(([, def]) => def.alias === key)?.[0];
  if (canonical) return `--${toKebabCase(canonical)}`;

  return key.length === SHORT_FLAG_LENGTH ? `-${key}` : `--${toKebabCase(key)}`;
}

export function convertNumbers(
  args: Record<string, string | boolean>,
  argDefs: Record<string, ArgDefinition>,
): ParsedArgs {
  for (const [key, value] of Object.entries(args)) {
    if (Array.isArray(value)) {
      throw new Exit(`${resolveFlagToken(key, argDefs)} can only be provided once`);
    }
  }

  const result: ParsedArgs = { ...args };

  for (const [key, def] of Object.entries(argDefs)) {
    if (def.type !== "number") continue;

    const value = args[key];
    if (value === undefined || typeof value === "boolean") continue;

    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`Invalid number for --${key}: "${value}"`);
    }
    result[key] = num;
  }

  return result;
}

export function parseGlobalArgs(argv: string[], globalArgs: Record<string, ArgDefinition>): GlobalParseResult {
  const opts = buildMriOptions(globalArgs);
  const parsed = mri(argv, opts);

  const command = parsed._[0] as string | undefined;
  const cmdIndex = command ? argv.indexOf(command) : -1;

  const { _, ...stringFlags } = parsed;
  const globalFlags = Object.fromEntries(
    Object.entries(stringFlags).filter(([key]) => key in globalArgs || key in opts.alias),
  );
  const flags = convertNumbers(globalFlags as Record<string, string | boolean>, globalArgs);

  return { command, flags, restArgs: cmdIndex >= 0 ? argv.slice(cmdIndex + 1) : [] };
}

export function parseCommandArgs(argv: string[], argDefs: Record<string, ArgDefinition> = {}): CommandParseResult {
  const opts = buildMriOptions(argDefs);
  const parsed = mri(argv, opts);

  const { _: rawPositionals, ...stringArgs } = parsed;
  const args = convertNumbers(stringArgs as Record<string, string | boolean>, argDefs);

  return { args, rawPositionals: rawPositionals as string[] };
}

export function mapPositionals(
  raw: string[],
  defs: Record<string, PositionalDefinition>,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  const entries = Object.entries(defs);

  for (const [i, [name, def]] of entries.entries()) {
    result[name] = def.variadic ? raw.slice(i) : raw[i];
  }

  return result;
}

export function validatePositionals(
  positionals: Record<string, string | string[] | undefined>,
  defs: Record<string, PositionalDefinition>,
): string | null {
  for (const [name, def] of Object.entries(defs)) {
    if (!def.required) continue;

    const value = positionals[name];
    const isEmpty = Array.isArray(value) ? value.length === 0 : !value;

    if (isEmpty) {
      return `Missing required argument: <${name}${def.variadic ? "..." : ""}>`;
    }
  }
  return null;
}
