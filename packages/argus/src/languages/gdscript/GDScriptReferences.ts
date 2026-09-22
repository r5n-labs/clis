import type { ReferenceOptions, ReferenceProvider } from "../../analysis/contracts";
import type { Project, SourceFile, SourceTarget } from "../../domain/source-target";
import { ReferenceSelection } from "./ReferenceSelection";
import { type ReferenceIndex, referenceIndex } from "./reference-index";
import type { ScriptRuntime } from "./runtime";
import type { ClassSymbols } from "./symbols";

export class GDScriptReferences implements ReferenceProvider {
  private readonly index: ReferenceIndex;
  private callers?: Map<string, SourceTarget[]>;

  constructor(project: Project, symbolsFor: (file: SourceFile) => readonly ClassSymbols[], runtime: ScriptRuntime) {
    this.index = referenceIndex(project, symbolsFor, runtime);
  }

  select(target: SourceTarget, options: ReferenceOptions = {}) {
    const owner = this.index.classes.find(
      (entry) => entry.file.path === target.path && entry.symbols.owner === target.owner,
    );
    if (!owner) return undefined;
    const selection = new ReferenceSelection(this.index, owner, target, options).build();
    return {
      ...selection,
      scope:
        options.depth === 0
          ? "Local contract review: complete method, class purpose, declarations, local helpers and inherited contract. External implementations are deliberately omitted. Missing dependencies are an extraction limit, not evidence that code needs documentation."
          : "Static reference selection: directly referenced methods and their local helpers, with class declarations. Further cross-file dependencies are unresolved unless included in an expanded review. Runtime overrides and dynamic wiring are not proven. Conventional fixture methods are evidence, not proof of lifecycle ordering. Missing implementation is not evidence of correct behaviour.",
    };
  }

  usages(target: SourceTarget): SourceTarget[] {
    if (!this.callers) {
      this.callers = new Map();
      for (const owner of this.index.classes) {
        for (const method of owner.symbols.methods) {
          const caller = owner.file.targets.find(
            (entry) => entry.group === "methods" && entry.owner === owner.symbols.owner && entry.name === method.name,
          );
          if (!caller) continue;
          const selection = new ReferenceSelection(this.index, owner, caller, {});
          for (const key of selection.directCalls(method)) {
            const callers = this.callers.get(key) ?? [];
            if (!callers.includes(caller)) callers.push(caller);
            this.callers.set(key, callers);
          }
        }
      }
    }
    return this.callers.get(`${target.path}:${target.owner}:${target.name}`) ?? [];
  }

  resourceSchema(path: string): string | undefined {
    const owner = this.index.classes.find((entry) => entry.file.path === path);
    if (!owner) return undefined;
    return [
      "Resource script declarations (method implementations omitted):",
      owner.target.documentation,
      ...owner.target.declarations,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}
