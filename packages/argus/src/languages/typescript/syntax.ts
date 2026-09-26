import type { Node } from "web-tree-sitter";
import type { Expression } from "./symbols";

const HEX_RADIX = 16;
const MAX_CODE_POINT = 0x10ffff;
const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
export const VALUE_WRAPPERS = new Set([
  "parenthesized_expression",
  "as_expression",
  "satisfies_expression",
  "type_assertion",
  "non_null_expression",
]);
export const FUNCTIONS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function",
  "method_definition",
]);

export function unwrapValue(node: Node): Node {
  let current = node;
  while (VALUE_WRAPPERS.has(current.type)) {
    const value = current.type === "type_assertion" ? current.namedChildren.at(-1) : current.namedChildren[0];
    if (!value) break;
    current = value;
  }
  return current;
}

export function valueWrapper(node: Node): Node {
  let current = node;
  while (current.parent && VALUE_WRAPPERS.has(current.parent.type)) current = current.parent;
  return current;
}

export function literal(node: Node | null): string | undefined {
  if (!node || !["string", "template_string"].includes(node.type)) return undefined;
  if (node.namedChildren.some((child) => child.type === "template_substitution")) return undefined;
  return node.text
    .slice(1, -1)
    .replace(
      /\\(?:u\{([\da-fA-F]+)\}|u([\da-fA-F]{4})|x([\da-fA-F]{2})|\r?\n|(.))/g,
      (
        escaped: string,
        point: string | undefined,
        unicode: string | undefined,
        hex: string | undefined,
        char: string | undefined,
      ) => {
        const code = point ?? unicode ?? hex;
        if (code) {
          const value = Number.parseInt(code, HEX_RADIX);
          return value <= MAX_CODE_POINT ? String.fromCodePoint(value) : escaped;
        }
        return char ? (ESCAPES[char] ?? char) : "";
      },
    );
}

export function expression(node: Node | null): Expression {
  if (!node) return { kind: "unknown", text: "Missing expression" };
  switch (node.type) {
    case "identifier":
    case "type_identifier":
    case "this":
    case "super":
      return { kind: "name", name: node.text };
    case "member_expression":
    case "nested_type_identifier": {
      const receiver = node.childForFieldName("object") ?? node.childForFieldName("module");
      const name = node.childForFieldName("property") ?? node.childForFieldName("name");
      if (receiver && name) return { kind: "member", receiver: expression(receiver), name: name.text };
      break;
    }
    case "subscript_expression": {
      const name = literal(node.childForFieldName("index"));
      if (name !== undefined) return { kind: "member", receiver: expression(node.childForFieldName("object")), name };
      break;
    }
    case "call_expression":
    case "new_expression":
      return {
        kind: node.type === "new_expression" ? "new" : "call",
        callee: expression(node.childForFieldName("function") ?? node.childForFieldName("constructor")),
      };
    case "type_annotation":
    case "parenthesized_expression":
    case "non_null_expression":
    case "await_expression":
    case "parenthesized_type":
    case "satisfies_expression":
      return expression(node.namedChildren[0] ?? null);
    case "as_expression":
      return expression(node.namedChildren.at(-1) ?? null);
    case "type_assertion":
      return expression(node.namedChildren[0]?.namedChildren[0] ?? null);
    case "generic_type":
      return expression(node.childForFieldName("name"));
  }
  return { kind: "unknown", text: node.text };
}

export function leadingComments(node: Node): string {
  const comments: string[] = [];
  let previous = node.previousNamedSibling;
  while (previous?.type === "comment") {
    comments.unshift(previous.text);
    previous = previous.previousNamedSibling;
  }
  return comments.join("\n");
}

export function identifiers(node: Node): string[] {
  return [...new Set(node.descendantsOfType(["identifier", "type_identifier"]).map((entry) => entry.text))];
}

export function patternNames(node: Node | null): string[] {
  if (!node) return [];
  switch (node.type) {
    case "identifier":
    case "shorthand_property_identifier_pattern":
      return [node.text];
    case "pair_pattern":
      return patternNames(node.childForFieldName("value"));
    case "assignment_pattern":
    case "object_assignment_pattern":
      return patternNames(node.childForFieldName("left"));
    default:
      return node.namedChildren.flatMap(patternNames);
  }
}
