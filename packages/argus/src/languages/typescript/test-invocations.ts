import type { Node } from "web-tree-sitter";
import { lookup, type Scope } from "./symbols";
import { literal, unwrapValue } from "./syntax";
import type { TestConvention, TestRole } from "./testing";

export type TestCallback = { role: TestRole; title: string; call: Node };

function callChain(node: Node | null): string[] {
  if (!node) return [];
  switch (node.type) {
    case "identifier":
      return [node.text];
    case "call_expression":
      return callChain(node.childForFieldName("function"));
    case "member_expression": {
      const parent = callChain(node.childForFieldName("object"));
      const property = node.childForFieldName("property")?.text;
      return parent.length && property ? [...parent, property] : [];
    }
    default:
      return [];
  }
}

export function testCallback(node: Node, scope: Scope, path: string, conventions: readonly TestConvention[]) {
  const chain = callChain(node.childForFieldName("function"));
  const root = chain.shift();
  if (!root) return undefined;
  const bindings = lookup(scope, root);
  const imported = bindings?.length === 1 ? bindings[0]?.imported : undefined;
  if (bindings && !imported) return undefined;
  const name = imported?.name === "*" ? chain.shift() : (imported?.name ?? root);
  if (!name) return undefined;
  const role = conventions
    .map((convention) =>
      convention.classify({ path, name, module: imported?.module, modifiers: chain, unbound: !bindings }),
    )
    .find(Boolean);
  if (!role) return undefined;
  const args = node.childForFieldName("arguments")?.namedChildren ?? [];
  const callback = args
    .map(unwrapValue)
    .findLast((arg) => ["arrow_function", "function_expression"].includes(arg.type));
  if (!callback) return undefined;
  const title = role === "fixture" ? name : (literal(args[0] ?? null) ?? `${name} [dynamic title]`);
  return { callback, metadata: { role, title, call: node } satisfies TestCallback };
}
