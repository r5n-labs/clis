import { posix } from "node:path";
import type { ModuleSymbols, Scope, Unit } from "./symbols";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".d.mts", ".d.cts"];
const SUBSTITUTIONS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".d.ts"],
  ".mjs": [".mts", ".d.mts"],
  ".cjs": [".cts", ".d.cts"],
};

export class ModuleIndex {
  readonly modules: ReadonlyMap<string, ModuleSymbols>;
  private readonly roots = new Map<Scope, ModuleSymbols>();
  private readonly owners = new Map<Unit, ModuleSymbols>();

  constructor(modules: ModuleSymbols[]) {
    this.modules = new Map(modules.map((module) => [module.path, module]));
    for (const module of modules) {
      this.roots.set(module.scope, module);
      for (const unit of module.units) this.owners.set(unit, module);
    }
  }

  module(scope: Scope): ModuleSymbols {
    let root = scope;
    while (root.parent) root = root.parent;
    const module = this.roots.get(root);
    if (!module) throw new Error("TypeScript scope has no owning module");
    return module;
  }

  owner(unit: Unit): ModuleSymbols {
    const module = this.owners.get(unit);
    if (!module) throw new Error("TypeScript declaration has no owning module");
    return module;
  }

  resolve(from: ModuleSymbols, reference: string): ModuleSymbols | undefined {
    if (!reference.startsWith(".")) return undefined;
    const path = posix.normalize(posix.join(posix.dirname(from.path), reference));
    if (path.startsWith("../") || posix.isAbsolute(path)) return undefined;
    const extension = posix.extname(path);
    const substitution = (SUBSTITUTIONS[extension] ?? []).map(
      (suffix) => `${path.slice(0, -extension.length)}${suffix}`,
    );
    const candidates = [
      ...substitution,
      path,
      ...EXTENSIONS.map((extension) => path + extension),
      ...EXTENSIONS.map((extension) => posix.join(path, `index${extension}`)),
    ];
    return candidates.map((candidate) => this.modules.get(candidate)).find(Boolean);
  }
}
