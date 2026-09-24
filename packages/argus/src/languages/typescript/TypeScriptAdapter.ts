import { SourceAdapter, type SourceCapabilities } from "../../analysis/contracts";
import type { Project, SourceFile } from "../../domain/source-target";
import { typescriptParser } from "./parser";
import type { ModuleSymbols } from "./symbols";
import { TypeScriptExtractor } from "./TypeScriptExtractor";
import { TypeScriptReferences } from "./TypeScriptReferences";
import type { TestConvention } from "./testing";

export class TypeScriptAdapter extends SourceAdapter {
  readonly id = "typescript";
  readonly language = "TypeScript";
  private readonly modules = new WeakMap<SourceFile, ModuleSymbols>();

  constructor(private readonly conventions: readonly TestConvention[] = []) {
    super();
  }

  supports(path: string): boolean {
    return /\.(?:ts|tsx|mts|cts)$/.test(path);
  }

  async parse(path: string, source: string): Promise<SourceFile> {
    const parser = await typescriptParser(path);
    return parser.read(path, source, (root) => {
      const symbols = new TypeScriptExtractor(path, source, this.conventions).extract(root);
      const file = this.sourceFile({
        path,
        source,
        targets: symbols.targets,
        references: [
          ...new Set(
            [...symbols.scope.bindings.values()]
              .flat()
              .flatMap((binding) => (binding.imported ? [binding.imported.module] : []))
              .concat(
                symbols.exports.flatMap((entry) => (entry.module ? [entry.module] : [])),
                symbols.stars.map((entry) => entry.module),
              ),
          ),
        ],
      });
      this.modules.set(file, symbols);
      return file;
    });
  }

  createContext(project: Project): SourceCapabilities {
    const modules = [...project.files.values()].flatMap((file) => {
      const module = this.modules.get(file);
      return module ? [module] : [];
    });
    const references = new TypeScriptReferences(modules);
    return {
      references,
      declarations: (path) => references.declarations(path),
      literalUsages: (literal) =>
        modules.flatMap((module) =>
          module.targets
            .filter((target) => target.group === "methods" && target.strings?.includes(literal))
            .map((target) => ({
              target,
              source: target.source,
              containsLiteral: (value: string) => target.strings?.includes(value) ?? false,
              related: [],
            })),
        ),
    };
  }
}
