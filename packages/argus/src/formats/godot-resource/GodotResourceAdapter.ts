import type { SourceCapabilities } from "../../analysis/contracts";
import { SourceAdapter } from "../../analysis/contracts";
import type { Project, SourceFile, SourceTarget } from "../../domain/source-target";
import { GodotResourceContext } from "./GodotResourceContext";
import { parseResource } from "./parser";

export class GodotResourceAdapter extends SourceAdapter {
  readonly id = "godot-resource";
  readonly language = "Godot project data";

  supports(path: string): boolean {
    return /\.(tres|tscn)$/.test(path);
  }

  async parse(path: string, source: string): Promise<SourceFile> {
    const sections = parseResource(path, source);
    const references = [
      ...new Set(
        sections
          .flatMap((section) => [
            ...section.strings,
            ...[...section.attributes.values()].flatMap((value) => (value.string ? [value.string] : [])),
          ])
          .filter((value) => value.startsWith("res://")),
      ),
    ];
    const target: SourceTarget = {
      id: `resources:${path}`,
      group: "resources",
      path,
      name: path,
      owner: path,
      line: 1,
      endLine: source.split("\n").length,
      source,
      comments: "",
      declarations: [],
      references,
      calls: [],
    };
    return this.sourceFile({ path, source, references, targets: [target] });
  }

  createContext(project: Project): SourceCapabilities {
    const context = new GodotResourceContext(project, this.id);
    return { references: context, literalUsages: (literal) => context.literalUsages(literal) };
  }
}
