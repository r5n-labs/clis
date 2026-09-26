import { Exit } from "@r5n/cli-core";
import type { Node } from "web-tree-sitter";
import { ONE_BASED_LINE } from "../../constants";

const STRING_NODES = ["string", "string_name"];
const HEX_RADIX = 16;
const MAX_CODE_POINT = 0x10ffff;
const ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  a: "\x07",
  b: "\b",
  f: "\f",
  v: "\v",
  '"': '"',
  "'": "'",
  "\\": "\\",
  "\n": "",
  "\r\n": "",
};

export function stringLiterals(node: Node): string[] {
  return [...new Set(node.descendantsOfType(STRING_NODES).map(stringValue))];
}

export function stringValue(node: Node): string {
  const opening = /^([r&]?)("""|'''|"|')/.exec(node.text);
  const prefix = opening?.[1];
  const delimiter = opening?.[2];
  if (prefix === undefined || !delimiter) throw invalidLiteral(node);
  const body = node.text.slice(prefix.length + delimiter.length, -delimiter.length);
  if (prefix === "r") return body;
  return body.replace(/\\(u[\da-fA-F]{4}|U[\da-fA-F]{6}|\r\n|[\s\S])/g, (_, sequence: string) => {
    if (sequence.startsWith("u") || sequence.startsWith("U")) {
      const codePoint = Number.parseInt(sequence.slice(1), HEX_RADIX);
      if (!Number.isFinite(codePoint) || codePoint > MAX_CODE_POINT) throw invalidLiteral(node);
      return String.fromCodePoint(codePoint);
    }
    const value = ESCAPES[sequence];
    if (value === undefined) throw invalidLiteral(node);
    return value;
  });
}

function invalidLiteral(node: Node): Exit {
  return new Exit(`Unsupported GDScript string literal at line ${node.startPosition.row + ONE_BASED_LINE}`);
}
