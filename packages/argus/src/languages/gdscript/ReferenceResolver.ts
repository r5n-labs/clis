import type { ReferenceEvidence } from "./ReferenceEvidence";
import type { Environment, IndexedClass, Lookup, Member, ReferenceIndex, ResolvedValue } from "./reference-index";
import type { MethodSymbols, SourceExpression } from "./symbols";

const DEFAULT_REFERENCE_DEPTH = 1;

type Traversal = {
  includeMethod(owner: IndexedClass, method: MethodSymbols): void;
  includeScene(owner: IndexedClass): void;
};

export class ReferenceResolver {
  private depths = new Map<string, number>();

  constructor(
    private readonly index: ReferenceIndex,
    private readonly evidence: ReferenceEvidence,
    private readonly traversal: Traversal,
    private readonly scope: { path: string; depth?: number },
  ) {
    this.depths.set(scope.path, 0);
  }

  resolve(expression: SourceExpression, environment: Environment, lookup: Lookup): ResolvedValue | undefined {
    const key = `${environment.owner.file.path}:${environment.owner.symbols.owner}:${environment.method?.name}:${JSON.stringify(expression)}`;
    if (lookup.visited.has(key)) return undefined;
    const next = { ...lookup, visited: new Set(lookup.visited).add(key) };
    switch (expression.kind) {
      case "unknown":
        return undefined;
      case "value":
        return { kind: "data" };
      case "path":
        return this.resolvePath(expression.path, lookup);
      case "name":
        return this.resolveName(expression.name, environment, next);
      case "member": {
        const receiver = this.resolve(expression.receiver, environment, next);
        if (receiver?.kind === "scene" && expression.name === "instantiate") {
          const path = this.index.runtime.resource(receiver.reference)?.script;
          const owner = this.index.classes.find((entry) => entry.file.path === path);
          return owner ? { kind: "constructor", owner } : undefined;
        }
        if (receiver?.kind !== "class") return undefined;
        if (expression.name === "new") return { kind: "constructor", owner: receiver.owner };
        return this.resolveMember(receiver.owner, expression.name, next);
      }
      case "call":
        return this.resolveCall(expression, environment, next);
    }
  }

  private resolveName(name: string, environment: Environment, lookup: Lookup): ResolvedValue | undefined {
    if (name === "self") return { kind: "class", owner: environment.owner };
    if (name === "super") return this.baseClass(environment.owner, lookup);
    const local = environment.method?.bindings.find((binding) => binding.name === name);
    if (local) return this.resolve(local.value, environment, lookup);
    const member = this.findMember(environment.owner, name, lookup);
    if (member) return this.resolveFoundMember(member, lookup);
    const singleton = this.index.runtime.singleton(name);
    if (singleton) {
      const { path, source } = singleton.evidence;
      this.evidence.addData(path, source, true);
      return this.resolvePath(singleton.reference, lookup);
    }
    const nested = this.index.classes.filter(
      (entry) =>
        entry.file === environment.owner.file && entry.symbols.owner === `${environment.owner.symbols.owner}.${name}`,
    );
    const candidates = nested.length ? nested : (this.index.globals.get(name) ?? []);
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (!candidate || !this.withinScope(candidate.file.path, lookup)) return undefined;
    this.evidence.includeClass(candidate);
    return { kind: "class", owner: candidate };
  }

  private resolveMember(owner: IndexedClass, name: string, lookup: Lookup): ResolvedValue | undefined {
    const nested = this.index.classes.find(
      (entry) => entry.file === owner.file && entry.symbols.owner === `${owner.symbols.owner}.${name}`,
    );
    if (nested) {
      this.evidence.includeClass(nested);
      return { kind: "class", owner: nested };
    }
    const member = this.findMember(owner, name, lookup);
    return member ? this.resolveFoundMember(member, lookup) : undefined;
  }

  private resolveFoundMember(member: Member, lookup: Lookup): ResolvedValue | undefined {
    this.evidence.includeClass(member.owner);
    if (member.method) return { kind: "method", owner: member.owner, method: member.method };
    if (member.binding) {
      this.evidence.includeBinding(member.owner, member.binding.name);
      if (member.binding.initialiser && !this.resolve(member.binding.initialiser, { owner: member.owner }, lookup))
        this.evidence.recordUnresolved(member.owner.file.path, member.binding.initialiser);
      return this.resolve(member.binding.value, { owner: member.owner }, lookup);
    }
    return undefined;
  }

  findMember(owner: IndexedClass, name: string, lookup: Lookup): Member | undefined {
    if (!this.withinScope(owner.file.path, lookup)) return undefined;
    const key = `member:${owner.file.path}:${owner.symbols.owner}:${name}`;
    if (lookup.visited.has(key)) return undefined;
    const next = { ...lookup, visited: new Set(lookup.visited).add(key) };
    const binding = owner.symbols.bindings.find((entry) => entry.name === name);
    if (binding) return { owner, binding };
    const method = owner.symbols.methods.find((entry) => entry.name === name);
    if (method) return { owner, method };
    const base = this.baseClass(owner, next);
    return base?.kind === "class" ? this.findMember(base.owner, name, next) : undefined;
  }

  baseClass(owner: IndexedClass, lookup: Lookup): ResolvedValue | undefined {
    if (!owner.symbols.base) return undefined;
    const base = this.resolve(owner.symbols.base, { owner }, { ...lookup, contract: true });
    return base?.kind === "class" ? base : undefined;
  }

  private resolveCall(
    call: Extract<SourceExpression, { kind: "call" }>,
    environment: Environment,
    lookup: Lookup,
  ): ResolvedValue | undefined {
    if (call.callee.kind === "member" && ["get_node", "get_node_or_null"].includes(call.callee.name)) {
      const receiver = this.resolve(call.callee.receiver, environment, lookup);
      const argument = call.arguments?.[0];
      if (receiver?.kind === "class" && argument?.kind === "value" && argument.text) {
        const node = this.index.runtime.node(receiver.owner.file.path, argument.text);
        if (node) {
          for (const entry of node.evidence) this.evidence.addData(entry.path, entry.source);
          return this.resolvePath(node.reference, lookup);
        }
      }
    }
    const callable = this.resolve(call.callee, environment, lookup);
    if (callable?.kind === "constructor") {
      const initialiser = this.findMember(callable.owner, "_init", lookup);
      if (initialiser?.method) this.traversal.includeMethod(initialiser.owner, initialiser.method);
      return { kind: "class", owner: callable.owner };
    }
    if (callable?.kind !== "method") return undefined;
    this.traversal.includeMethod(callable.owner, callable.method);
    if (!callable.method.returnType) return { kind: "data" };
    return this.resolve(callable.method.returnType, { owner: callable.owner }, lookup) ?? { kind: "data" };
  }

  private resolvePath(reference: string, lookup: Lookup): ResolvedValue | undefined {
    const resource = this.index.runtime.resource(reference);
    const file = resource ? this.index.project.files.get(resource.path) : undefined;
    if (!file || !this.withinScope(file.path, lookup)) return undefined;
    const owner = this.index.classes.find((entry) => entry.file === file);
    if (owner) {
      this.evidence.includeClass(owner);
      return { kind: "class", owner };
    }
    this.evidence.addData(file.path, file.source);
    const script = resource?.script;
    const scriptOwner = this.index.classes.find((entry) => entry.file.path === script);
    if (scriptOwner && this.withinScope(scriptOwner.file.path, lookup)) {
      this.evidence.includeClass(scriptOwner);
      this.traversal.includeScene(scriptOwner);
    }
    if (resource?.kind === "scene") return { kind: "scene", reference };
    if (resource?.kind === "resource" && scriptOwner) return { kind: "class", owner: scriptOwner };
    return { kind: "data" };
  }

  private withinScope(path: string, lookup: Lookup): boolean {
    const originDepth = this.depths.get(lookup.origin) ?? 0;
    const depth = path === lookup.origin || lookup.contract ? originDepth : originDepth + 1;
    if (!lookup.contract && depth > (this.scope.depth ?? DEFAULT_REFERENCE_DEPTH)) return false;
    this.depths.set(path, Math.min(this.depths.get(path) ?? depth, depth));
    return true;
  }
}
