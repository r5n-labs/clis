const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ESCAPE_PAIR_SIZE = 2;
const FIRST_VALUE_CHARACTER_INDEX = 1;
const NOT_FOUND_INDEX = -1;

export function parseDotenv(input: string): Record<string, string> {
  const env = Object.create(null) as Record<string, string>;
  const lines = input.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + FIRST_VALUE_CHARACTER_INDEX;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const body = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = body.indexOf("=");
    if (equalsIndex < 0) {
      throw new Error(`Invalid dotenv syntax at line ${lineNumber}: expected KEY=VALUE`);
    }

    const key = body.slice(0, equalsIndex).trim();
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`Invalid dotenv key at line ${lineNumber}`);
    }

    env[key] = parseValue(body.slice(equalsIndex + 1).trim());
  }

  return env;
}

export function serializeDotenv(env: Record<string, string>): string {
  return Object.keys(env)
    .sort()
    .map((key, index) => {
      const entryNumber = index + FIRST_VALUE_CHARACTER_INDEX;
      if (!KEY_PATTERN.test(key)) {
        throw new Error(`Invalid dotenv key at entry ${entryNumber}`);
      }

      const value = env[key] ?? "";
      const formattedValue = formatValue(value, entryNumber);
      if (parseValue(formattedValue) !== value) {
        throw new Error(`Unrepresentable dotenv value at entry ${entryNumber}`);
      }

      return `${key}=${formattedValue}`;
    })
    .join("\n")
    .concat("\n");
}

function parseValue(value: string): string {
  if (value.startsWith('"')) {
    const quoted = readQuotedValue(value, '"');
    if (quoted !== undefined) {
      return decodeDoubleQuotedValue(quoted);
    }
  }

  if (value.startsWith("'")) {
    const quoted = readQuotedValue(value, "'");
    if (quoted !== undefined) return decodeDollarEscapes(quoted);
  }

  return decodeDollarEscapes(stripInlineComment(value).trimEnd());
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

function decodeDoubleQuotedValue(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\" || index + FIRST_VALUE_CHARACTER_INDEX >= value.length) {
      decoded += character;
      continue;
    }

    const escaped = value[index + FIRST_VALUE_CHARACTER_INDEX];
    const replacement = decodeDoubleQuotedCharacter(escaped);
    if (replacement === undefined) {
      decoded += character;
      continue;
    }

    decoded += replacement;
    index += FIRST_VALUE_CHARACTER_INDEX;
  }

  return decoded;
}

function decodeDoubleQuotedCharacter(character: string | undefined): string | undefined {
  if (character === "n") return "\n";
  if (character === "r") return "\r";
  if (character === "t") return "\t";
  if (character === '"') return '"';
  if (character === "\\") return "\\";
  if (character === "$") return "$";
  return undefined;
}

function decodeDollarEscapes(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\" && value[index + FIRST_VALUE_CHARACTER_INDEX] === "$") {
      decoded += "$";
      index += FIRST_VALUE_CHARACTER_INDEX;
      continue;
    }

    decoded += value[index];
  }

  return decoded;
}

function formatValue(value: string, entryNumber: number): string {
  if (value.includes("\0")) {
    throw new Error(`Unrepresentable dotenv value at entry ${entryNumber}`);
  }

  if (value === "") return "";
  const expansionSafeValue = escapeDollarExpansions(value);
  if (canUseUnquotedValue(value)) return expansionSafeValue;

  const hasLineBreak = value.includes("\n") || value.includes("\r");
  if (!hasLineBreak && !value.includes("'") && !hasOddTrailingBackslashes(value)) {
    return `'${expansionSafeValue}'`;
  }

  if (!value.includes('"') && !value.includes("\\")) {
    return `"${formatDoubleQuotedValue(value)}"`;
  }

  throw new Error(`Unrepresentable dotenv value at entry ${entryNumber}`);
}

function canUseUnquotedValue(value: string): boolean {
  if (value.includes("\n") || value.includes("\r") || value.includes("#")) return false;
  if (value.trim() !== value) return false;
  return !value.startsWith('"') && !value.startsWith("'") && !value.startsWith("`");
}

function escapeDollarExpansions(value: string): string {
  let escaped = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const startsExpansion = character === "$" && index + FIRST_VALUE_CHARACTER_INDEX < value.length;
    escaped += startsExpansion ? `\\${character}` : character;
  }

  return escaped;
}

function hasOddTrailingBackslashes(value: string): boolean {
  let slashCount = 0;

  for (let index = value.length - FIRST_VALUE_CHARACTER_INDEX; value[index] === "\\"; index -= 1) {
    slashCount += 1;
  }

  return slashCount % ESCAPE_PAIR_SIZE === FIRST_VALUE_CHARACTER_INDEX;
}

function formatDoubleQuotedValue(value: string): string {
  return escapeDollarExpansions(value).replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}
