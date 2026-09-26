import type { ModuleIndex } from "./ModuleIndex";
import { type Binding, type Expression, lookup, type ModuleSymbols, type Scope, type Unit } from "./symbols";

export type Resolved = { kind: "unit"; unit: Unit } | { kind: "module"; module: ModuleSymbols };
export type ResolutionEvidence = (unit: Unit) => void;

export class SymbolResolver {
  constructor(private readonly index: ModuleIndex) {}

  resolve(
    expression: Expression,
    scope: Scope,
    include: ResolutionEvidence,
    seen = new Set<unknown>(),
  ): Resolved | undefined {
    switch (expression.kind) {
      case "unknown":
        return undefined;
      case "name":
        return this.resolveName(expression.name, scope, include, seen);
      case "member": {
        const receiver = this.resolve(expression.receiver, scope, include, seen);
        return receiver ? this.member(receiver, expression.name, include, seen) : undefined;
      }
      case "call":
      case "new": {
        const callable = this.resolve(expression.callee, scope, include, seen);
        if (callable?.kind !== "unit") return undefined;
        if (expression.kind === "new" && callable.unit.kind === "class") {
          this.member(callable, "constructor", include, seen);
          return callable;
        }
        if (callable.unit.returnType)
          return this.resolve(
            callable.unit.returnType,
            callable.unit.returnScope ?? callable.unit.scope,
            include,
            seen,
          );
        return undefined;
      }
    }
  }

  member(
    receiver: Resolved,
    name: string,
    include: ResolutionEvidence,
    seen = new Set<unknown>(),
  ): Resolved | undefined {
    if (receiver.kind === "module") return this.exported(receiver.module, name, include, seen);
    const { unit } = receiver;
    if (seen.has(unit)) return undefined;
    const next = new Set(seen).add(unit);
    const own = unit.members?.bindings.get(name)?.filter((binding) => binding.member);
    if (own?.length) return this.bindings(own, include, next);
    for (const base of unit.bases) {
      const resolved = this.resolve(base, unit.scope, include, next);
      const member = resolved ? this.member(resolved, name, include, next) : undefined;
      if (member) return member;
    }
    return undefined;
  }

  private resolveName(
    name: string,
    scope: Scope,
    include: ResolutionEvidence,
    seen: Set<unknown>,
  ): Resolved | undefined {
    if (name !== "this" && name !== "super") return this.bindings(lookup(scope, name), include, seen);
    let current: Scope | undefined = scope;
    while (current) {
      if (current.thisBoundary) return this.bindings(current.bindings.get(name), include, seen);
      if (current.thisOwner) {
        const owner = current.thisOwner;
        if (name === "this") return { kind: "unit", unit: owner };
        const base = owner.bases[0];
        return base ? this.resolve(base, owner.scope, include, seen) : undefined;
      }
      current = current.parent;
    }
    return this.bindings(lookup(scope, name), include, seen);
  }

  private bindings(
    bindings: Binding[] | undefined,
    include: ResolutionEvidence,
    seen: Set<unknown>,
  ): Resolved | undefined {
    if (!bindings?.length) return undefined;
    const implementations = bindings.filter((binding) => binding.unit?.kind === "function");
    const candidates =
      implementations.length === 1 &&
      bindings.every((binding) => binding === implementations[0] || binding.overloadSignature)
        ? implementations
        : bindings;
    for (const binding of bindings) if (binding.unit) include(binding.unit);
    if (candidates.length !== 1) {
      return undefined;
    }
    const binding = candidates[0];
    if (!binding || seen.has(binding)) return undefined;
    const next = new Set(seen).add(binding);
    if (binding.unit) include(binding.unit);
    if (binding.reassigned && !binding.type) return undefined;
    if (binding.imported) {
      const module = this.index.resolve(this.index.module(binding.scope), binding.imported.module);
      return module ? this.exported(module, binding.imported.name, include, next) : undefined;
    }
    const evaluationScope = binding.evaluationScope ?? binding.scope;
    if (binding.type) return this.resolve(binding.type, evaluationScope, include, next);
    if (binding.unit && (binding.unit.kind === "function" || binding.unit.kind === "class" || binding.unit.members))
      return { kind: "unit", unit: binding.unit };
    if (binding.value) return this.resolve(binding.value, evaluationScope, include, next);
    return binding.unit ? { kind: "unit", unit: binding.unit } : undefined;
  }

  private exported(
    module: ModuleSymbols,
    name: string,
    include: ResolutionEvidence,
    seen: Set<unknown>,
  ): Resolved | undefined {
    if (name === "*") return { kind: "module", module };
    const key = `${module.path}:${name}`;
    if (seen.has(key)) return undefined;
    const next = new Set(seen).add(key);
    const entries = module.exports.filter((entry) => entry.name === name);
    if (entries.length > 1) return undefined;
    const entry = entries[0];
    if (name === "export=" && !entry) return { kind: "module", module };
    if (entry) {
      if (entry.unit) include(entry.unit);
      if (entry.module) {
        const dependency = this.index.resolve(module, entry.module);
        return dependency ? this.exported(dependency, entry.imported ?? name, include, next) : undefined;
      }
      if (entry.local) return this.bindings(lookup(module.scope, entry.local), include, next);
      return entry.unit ? { kind: "unit", unit: entry.unit } : undefined;
    }
    if (name === "default") return undefined;
    const found: Resolved[] = [];
    for (const star of module.stars) {
      const dependency = this.index.resolve(module, star.module);
      const resolved = dependency ? this.exported(dependency, name, include, next) : undefined;
      if (resolved) {
        include(star.unit);
        found.push(resolved);
      }
    }
    const unique = [...new Set(found.map((item) => (item.kind === "unit" ? item.unit : item.module)))];
    return unique.length === 1 ? found[0] : undefined;
  }
}
