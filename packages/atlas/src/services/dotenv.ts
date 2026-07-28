export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ESCAPE_PAIR_SIZE = 2;
const FIRST_VALUE_CHARACTER_INDEX = 1;
const NOT_FOUND_INDEX = -1;
const QUOTE_CHARACTERS = ['"', "'", "`"] as const;

type QuoteCharacter = (typeof QUOTE_CHARACTERS)[number];

type MultilineValue = { endIndex: number; value: string };

export function parseDotenv(input: string): Record<string, string> {
  const env = Object.create(null) as Record<string, string>;
  const lines = input.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + FIRST_VALUE_CHARACTER_INDEX;
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const body = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = body.indexOf("=");
    if (equalsIndex < 0) {
      throw new Error(`Invalid dotenv syntax at line ${lineNumber}: expected KEY=VALUE`);
    }

    const key = body.slice(0, equalsIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid dotenv key at line ${lineNumber}`);
    }

    const value = body.slice(equalsIndex + 1).trim();
    const multiline = readMultilineQuotedValue(value, rawLine, lines, index);
    if (multiline) {
      env[key] = multiline.value;
      index = multiline.endIndex;
      continue;
    }

    env[key] = parseValue(value);
  }

  return env;
}

export function serializeDotenv(env: Record<string, string>): string {
  return Object.keys(env)
    .sort()
    .map((key, index) => {
      const entryNumber = index + FIRST_VALUE_CHARACTER_INDEX;
      if (!ENV_KEY_PATTERN.test(key)) {
        throw new Error(`Invalid dotenv key at entry ${entryNumber}`);
      }

      const value = env[key] ?? "";
      const formattedValue = formatValue(value, key);
      if (parseValue(formattedValue) !== value) {
        throw new Error(`Unrepresentable dotenv value for key ${key}`);
      }

      return `${key}=${formattedValue}`;
    })
    .join("\n")
    .concat("\n");
}

function readMultilineQuotedValue(
  value: string,
  rawLine: string,
  lines: string[],
  lineIndex: number,
): MultilineValue | undefined {
  const quote = toQuoteCharacter(value[0]);
  if (quote === undefined) return undefined;
  if (findUnescapedQuote(value, quote, FIRST_VALUE_CHARACTER_INDEX) !== NOT_FOUND_INDEX) return undefined;

  const openingQuoteIndex = rawLine.indexOf(quote);
  const fragments = [rawLine.slice(openingQuoteIndex + FIRST_VALUE_CHARACTER_INDEX)];

  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const fragment = lines[index] ?? "";
    const closingQuoteIndex = findUnescapedQuote(fragment, quote, 0);
    if (closingQuoteIndex === NOT_FOUND_INDEX) {
      fragments.push(fragment);
      continue;
    }

    fragments.push(fragment.slice(0, closingQuoteIndex));
    return { endIndex: index, value: decodeQuotedValue(fragments.join("\n"), quote) };
  }

  return undefined;
}

function parseValue(value: string): string {
  const quote = toQuoteCharacter(value[0]);
  if (quote !== undefined) {
    const quoted = readQuotedValue(value, quote);
    if (quoted !== undefined) return decodeQuotedValue(quoted, quote);
  }

  return decodeDollarEscapes(stripInlineComment(value).trimEnd());
}

function toQuoteCharacter(character: string | undefined): QuoteCharacter | undefined {
  return QUOTE_CHARACTERS.find((quote) => quote === character);
}

function decodeQuotedValue(value: string, quote: QuoteCharacter): string {
  return quote === '"' ? decodeDoubleQuotedValue(value) : decodeDollarEscapes(value);
}

function readQuotedValue(value: string, quote: QuoteCharacter): string | undefined {
  const endIndex = findUnescapedQuote(value, quote, FIRST_VALUE_CHARACTER_INDEX);
  if (endIndex === NOT_FOUND_INDEX) return undefined;

  const trailing = value.slice(endIndex + FIRST_VALUE_CHARACTER_INDEX).trimStart();
  if (trailing && !trailing.startsWith("#")) return undefined;

  return value.slice(FIRST_VALUE_CHARACTER_INDEX, endIndex);
}

function findUnescapedQuote(value: string, quote: QuoteCharacter, fromIndex: number): number {
  for (let index = fromIndex; index < value.length; index += 1) {
    if (value[index] === quote && !hasOddBackslashRunBefore(value, index)) return index;
  }

  return NOT_FOUND_INDEX;
}

function hasOddBackslashRunBefore(value: string, index: number): boolean {
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

function formatValue(value: string, key: string): string {
  if (value.includes("\0")) {
    throw new Error(`Unrepresentable dotenv value for key ${key}`);
  }

  if (value === "") return "";
  const expansionSafeValue = escapeDollarExpansions(value);
  if (canUseUnquotedValue(value)) return expansionSafeValue;

  const hasLineBreak = value.includes("\n") || value.includes("\r");
  if (!hasLineBreak && !value.includes("'") && !hasOddBackslashRunBefore(value, value.length)) {
    return `'${expansionSafeValue}'`;
  }

  if (!value.includes('"') && !value.includes("\\")) {
    return `"${formatDoubleQuotedValue(value)}"`;
  }

  throw new Error(`Unrepresentable dotenv value for key ${key}`);
}

function canUseUnquotedValue(value: string): boolean {
  if (value.includes("\n") || value.includes("\r") || value.includes("#")) return false;
  if (value.trim() !== value) return false;
  return toQuoteCharacter(value[0]) === undefined;
}

function escapeDollarExpansions(value: string): string {
  return value.replace(/\$(?!$)/g, "\\$&");
}

function formatDoubleQuotedValue(value: string): string {
  return escapeDollarExpansions(value).replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}
