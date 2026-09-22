import type { Node } from "web-tree-sitter";
import { stringValue } from "./string-literals";
import type { ClassSymbols, DeclarationSymbols, MethodSymbols, SourceBinding, SourceExpression } from "./symbols";

const METHODS = new Set(["function_definition", "constructor_definition"]);
const BINDINGS = new Set(["variable_statement", "const_statement"]);

export function classSymbols({
  scope,
  owner,
  declarations,
  definition,
}: {
  scope: Node;
  owner: string;
  declarations: readonly DeclarationSymbols[];
  definition?: Node;
}): ClassSymbols {
  const methods = scope.namedChildren.filter((node) => METHODS.has(node.type));
  const bindings = scope.namedChildren.filter((node) => BINDINGS.has(node.type)).map(binding);
  invalidateAssignments(
    bindings,
    methods.flatMap((method) => scopedNodes(method)),
  );
  const baseNode =
    definition?.childForFieldName("extends")?.namedChildren[0] ??
    scope.namedChildren.find((node) => node.type === "extends_statement")?.namedChildren[0];
  return {
    declarations,
    owner,
    globalName: scope.namedChildren.find((node) => node.type === "class_name_statement")?.childForFieldName("name")
      ?.text,
    base: baseNode ? (baseNode.type === "string" ? resourcePath(baseNode) : expression(baseNode)) : undefined,
    bindings,
    operations: scope.namedChildren
      .filter((node) => !METHODS.has(node.type) && node.type !== "class_definition")
      .flatMap((node) => operations(scopedNodes(node))),
    methods: methods.map(methodSymbols),
  };
}

function methodSymbols(node: Node): MethodSymbols {
  const nodes = scopedNodes(node);
  const parameters = node.childForFieldName("parameters")?.namedChildren ?? [];
  const bindings = [
    ...parameters.map((parameter): SourceBinding => {
      const name =
        parameter.type === "identifier" ? parameter.text : (parameter.namedChildren[0]?.text ?? parameter.text);
      const type = parameter.childForFieldName("type");
      return { name, value: type ? expression(type) : unknown(name), typed: Boolean(type) };
    }),
    ...nodes.filter((entry) => BINDINGS.has(entry.type)).map(binding),
    ...nodes
      .filter((entry) => entry.type === "for_statement")
      .map(
        (entry): SourceBinding => ({
          name: entry.childForFieldName("left")?.text ?? "",
          value: unknown(entry.text),
          typed: false,
        }),
      ),
    ...nodes
      .filter((entry) => entry.type === "pattern_binding")
      .map(
        (entry): SourceBinding => ({
          name: entry.namedChildren[0]?.text ?? "",
          value: unknown(entry.text),
          typed: false,
        }),
      ),
  ];
  invalidateAssignments(bindings, nodes);
  const returnType = node.childForFieldName("return_type");
  return {
    name: node.type === "constructor_definition" ? "_init" : (node.childForFieldName("name")?.text ?? ""),
    bindings,
    operations: operations(nodes),
    uses: [...new Set(nodes.filter((entry) => entry.type === "identifier").map((entry) => entry.text))],
    returnType: returnType ? expression(returnType) : undefined,
  };
}

function operations(nodes: Node[]): SourceExpression[] {
  return nodes.filter((entry) => ["call", "attribute", "lambda"].includes(entry.type)).map(expression);
}

function binding(node: Node): SourceBinding {
  const name = node.childForFieldName("name")?.text ?? "";
  const type = node.childForFieldName("type");
  const typed = type?.type === "type" && node.type !== "const_statement";
  const value = typed ? type : node.childForFieldName("value");
  const initialiser = typed ? node.childForFieldName("value") : undefined;
  return {
    name,
    value: value ? expression(value) : unknown(name),
    typed,
    initialiser: initialiser ? expression(initialiser) : undefined,
  };
}

function invalidateAssignments(bindings: SourceBinding[], nodes: Node[]): void {
  for (const entry of bindings) {
    const duplicates = bindings.filter((other) => other.name === entry.name).length > 1;
    const assigned = nodes.some((node) => {
      if (node.type !== "assignment" && node.type !== "augmented_assignment") return false;
      const left = node.childForFieldName("left")?.text;
      return left === entry.name || left === `self.${entry.name}`;
    });
    if (duplicates || (!entry.typed && assigned)) entry.value = unknown(`Ambiguous binding: ${entry.name}`);
  }
}

function scopedNodes(root: Node): Node[] {
  const result: Node[] = [];
  const visit = (node: Node) => {
    if (node !== root && (METHODS.has(node.type) || node.type === "class_definition")) return;
    result.push(node);
    if (node.type === "lambda") return;
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return result;
}

function unknown(text: string): SourceExpression {
  return { kind: "unknown", text };
}

function resourcePath(node: Node): SourceExpression {
  const path = stringValue(node);
  return path.startsWith("res://") && !path.includes("\\") ? { kind: "path", path } : unknown(node.text);
}

function expression(node: Node): SourceExpression {
  switch (node.type) {
    case "identifier":
    case "name":
      return { kind: "name", name: node.text };
    case "type":
    case "parenthesized_expression": {
      const child = node.namedChildren[0];
      return child && node.namedChildren.length === 1 ? expression(child) : unknown(node.text);
    }
    case "string":
    case "string_name":
      return { kind: "value", text: stringValue(node) };
    case "integer":
    case "float":
    case "true":
    case "false":
    case "null":
    case "array":
    case "dictionary":
      return { kind: "value" };
    case "binary_operator": {
      const cast = node.childForFieldName("op")?.text === "as";
      const type = node.childForFieldName("right");
      return cast && type ? expression(type) : unknown(node.text);
    }
    case "attribute":
      return attributeExpression(node);
    case "call": {
      const callee = node.namedChildren[0];
      const argument = node.childForFieldName("arguments")?.namedChildren[0];
      if (callee && ["preload", "load"].includes(callee.text) && argument?.type === "string")
        return resourcePath(argument);
      return callee
        ? {
            kind: "call",
            callee: expression(callee),
            arguments: node.childForFieldName("arguments")?.namedChildren.map(expression),
          }
        : unknown(node.text);
    }
    default:
      return unknown(node.text);
  }
}

function attributeExpression(node: Node): SourceExpression {
  const [first, ...members] = node.namedChildren;
  if (!first) return unknown(node.text);
  let current = expression(first);
  for (const member of members) {
    const name = member.type === "attribute_call" ? member.namedChildren[0]?.text : member.text;
    if (!name) return unknown(node.text);
    current = { kind: "member", receiver: current, name };
    if (member.type === "attribute_call")
      current = {
        kind: "call",
        callee: current,
        arguments: member.childForFieldName("arguments")?.namedChildren.map(expression),
      };
  }
  return current;
}
