const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ESCAPE_PAIR_SIZE = 2;
const FIRST_VALUE_CHARACTER_INDEX = 1;
const NOT_FOUND_INDEX = -1;

export function parseDotenv(input: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = input.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const body = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = body.indexOf("=");
    if (equalsIndex < 0) {
      throw new Error(`Invalid dotenv line: ${rawLine}`);
    }

    const key = body.slice(0, equalsIndex).trim();
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`Invalid dotenv key: ${key}`);
    }

    env[key] = parseValue(body.slice(equalsIndex + 1).trim());
  }

  return env;
}

export function serializeDotenv(env: Record<string, string>): string {
  return Object.keys(env)
    .sort()
    .map((key) => `${key}=${formatValue(env[key] ?? "")}`)
    .join("\n")
    .concat("\n");
}

function parseValue(value: string): string {
  if (value.startsWith('"')) {
    const quoted = readQuotedValue(value, '"');
    if (quoted !== undefined) {
      return quoted
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }

  if (value.startsWith("'")) {
    const quoted = readQuotedValue(value, "'");
    if (quoted !== undefined) return quoted;
  }

  return stripInlineComment(value).trimEnd();
}

function readQuotedValue(value: string, quote: '"' | "'"): string | undefined {
  const endIndex = findClosingQuote(value, quote);
  if (endIndex === NOT_FOUND_INDEX) return undefined;

  const trailing = value.slice(endIndex + FIRST_VALUE_CHARACTER_INDEX).trimStart();
  if (trailing && !trailing.startsWith("#")) return undefined;

  return value.slice(FIRST_VALUE_CHARACTER_INDEX, endIndex);
}

function findClosingQuote(value: string, quote: '"' | "'"): number {
  for (let index = FIRST_VALUE_CHARACTER_INDEX; index < value.length; index += 1) {
    if (value[index] === quote && !isEscapedQuote(value, index, quote)) return index;
  }

  return NOT_FOUND_INDEX;
}

function isEscapedQuote(value: string, index: number, quote: '"' | "'"): boolean {
  if (quote === "'") return false;

  let slashCount = 0;
  for (let slashIndex = index - FIRST_VALUE_CHARACTER_INDEX; value[slashIndex] === "\\"; slashIndex -= 1) {
    slashCount += 1;
  }

  return slashCount % ESCAPE_PAIR_SIZE === FIRST_VALUE_CHARACTER_INDEX;
}

function stripInlineComment(value: string): string {
  const index = value.search(/\s#/);
  return index < 0 ? value : value.slice(0, index);
}

function formatValue(value: string): string {
  if (value === "") return "";
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;

  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return `"${escaped}"`;
}
