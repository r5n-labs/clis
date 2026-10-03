import type { Project, SourceFile, SourceTarget } from "../../domain/source-target";
import type { ScriptRuntime } from "./runtime";
import type { ClassSymbols, MethodSymbols, SourceBinding } from "./symbols";

export type IndexedClass = { file: SourceFile; symbols: ClassSymbols; target: SourceTarget };
export type ReferenceIndex = {
  runtime: ScriptRuntime;
  project: Project;
  classes: IndexedClass[];
  globals: Map<string, IndexedClass[]>;
};
export type Environment = { owner: IndexedClass; method?: MethodSymbols };
export type Lookup = { visited: Set<string>; origin: string; contract?: boolean };
export type ResolvedValue =
  | { kind: "class"; owner: IndexedClass }
  | { kind: "method"; owner: IndexedClass; method: MethodSymbols }
  | { kind: "constructor"; owner: IndexedClass }
  | { kind: "scene"; reference: string }
  | { kind: "data" };
export type Member = { owner: IndexedClass; binding?: SourceBinding; method?: MethodSymbols };

export function referenceIndex(
  project: Project,
  symbolsFor: (file: SourceFile) => readonly ClassSymbols[],
  runtime: ScriptRuntime,
): ReferenceIndex {
  const index: ReferenceIndex = { project, runtime, classes: [], globals: new Map() };
  for (const file of project.files.values()) {
    for (const symbols of symbolsFor(file)) {
      const target = file.targets.find((entry) => entry.group === "classes" && entry.owner === symbols.owner);
      if (!target) continue;
      const entry = { file, symbols, target };
      index.classes.push(entry);
      if (symbols.globalName)
        index.globals.set(symbols.globalName, [...(index.globals.get(symbols.globalName) ?? []), entry]);
    }
  }
  return index;
}
