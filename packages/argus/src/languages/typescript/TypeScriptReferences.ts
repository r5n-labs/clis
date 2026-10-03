import type { ReferenceOptions, ReferenceProvider, ReferenceSelection as Selection } from "../../analysis/contracts";
import type { SourceTarget } from "../../domain/source-target";
import { ModuleIndex } from "./ModuleIndex";
import { ReferenceSelection } from "./ReferenceSelection";
import { SymbolResolver } from "./SymbolResolver";
import type { ModuleSymbols } from "./symbols";

export class TypeScriptReferences implements ReferenceProvider {
  private readonly index: ModuleIndex;

  constructor(modules: ModuleSymbols[]) {
    this.index = new ModuleIndex(modules);
  }

  select(target: SourceTarget, options: ReferenceOptions): Selection | undefined {
    const module = this.index.modules.get(target.path);
    return module ? new ReferenceSelection(this.index, module, target, options).build() : undefined;
  }

  declarations(path: string): string | undefined {
    const module = this.index.modules.get(path);
    return module?.units
      .filter((unit) => unit.scope === module.scope && unit.kind !== "function")
      .map((unit) => (unit.kind === "class" ? unit.header : unit.source))
      .join("\n\n");
  }

  usages(target: SourceTarget): readonly SourceTarget[] {
    const resolver = new SymbolResolver(this.index);
    const usages: SourceTarget[] = [];
    for (const module of this.index.modules.values()) {
      for (const unit of module.units) {
        const candidate = unit.target;
        if (candidate?.group !== "methods" || candidate.id === target.id) continue;
        const callsTarget = unit.uses.some((use) => {
          if (use.expression.kind !== "call" && use.expression.kind !== "new") return false;
          const callee = resolver.resolve(use.expression.callee, use.scope, () => {});
          return callee?.kind === "unit" && target.id === `${target.group}:${callee.unit.id}`;
        });
        if (callsTarget) usages.push(candidate);
      }
    }
    return usages;
  }
}
