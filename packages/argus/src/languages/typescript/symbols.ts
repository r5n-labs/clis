import type { SourceTarget } from "../../domain/source-target";
import type { TestRole } from "./testing";

export type Expression =
  | { kind: "name"; name: string }
  | { kind: "member"; receiver: Expression; name: string }
  | { kind: "call" | "new"; callee: Expression }
  | { kind: "unknown"; text: string };

export type Binding = {
  name: string;
  scope: Scope;
  evaluationScope?: Scope;
  unit?: Unit;
  value?: Expression;
  type?: Expression;
  imported?: { module: string; name: string };
  reassigned?: boolean;
  reserved?: boolean;
  member?: boolean;
  overloadSignature?: boolean;
};
export type Scope = {
  name: string;
  parent?: Scope;
  owner?: Unit;
  bindings: Map<string, Binding[]>;
  thisBoundary?: boolean;
  thisOwner?: Unit;
  declarationBoundary?: boolean;
};
export type Use = { expression: Expression; scope: Scope; text: string; reportUnresolved: boolean };
export type Unit = {
  id: string;
  name: string;
  kind: "function" | "class" | "declaration" | "import";
  scope: Scope;
  members?: Scope;
  source: string;
  header: string;
  comments: string;
  documentation: string;
  line: number;
  endLine: number;
  start: number;
  end: number;
  uses: Use[];
  bases: Expression[];
  returnType?: Expression;
  returnScope?: Scope;
  target?: SourceTarget;
  role?: TestRole;
};
export type ExportBinding = { name: string; local?: string; module?: string; imported?: string; unit?: Unit };
export type ModuleSymbols = {
  path: string;
  scope: Scope;
  units: Unit[];
  exports: ExportBinding[];
  stars: { module: string; unit: Unit }[];
  targets: SourceTarget[];
};

export function bind(scope: Scope, binding: Omit<Binding, "scope">): void {
  const current = (scope.bindings.get(binding.name) ?? []).filter((entry) => !entry.reserved);
  current.push({ ...binding, scope });
  scope.bindings.set(binding.name, current);
}

export function lookup(scope: Scope, name: string): Binding[] | undefined {
  const bindings = scope.bindings.get(name)?.filter((binding) => !binding.member);
  return bindings?.length ? bindings : scope.parent ? lookup(scope.parent, name) : undefined;
}

export function bindDeclaration(scope: Scope, binding: Omit<Binding, "scope" | "member">): void {
  bind(scope, { ...binding, member: scope.owner?.members === scope });
}
