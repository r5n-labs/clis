import type {
  EvidenceSource,
  LiteralUsage,
  ReferenceOptions,
  ReferenceProvider,
  ReferenceSelection,
} from "../../analysis/contracts";
import type { Project, SourceTarget } from "../../domain/source-target";
import { attribute, type ResourceSection, resourceSections } from "./parser";
import { resourceEvidence } from "./records";

export class GodotResourceContext implements ReferenceProvider {
  constructor(
    private readonly project: Project,
    private readonly adapterId: string,
  ) {}

  select(target: SourceTarget, options: ReferenceOptions): ReferenceSelection {
    const related = new Map<string, string>();
    if (options.depth !== 0) {
      for (const reference of target.references) {
        if (!reference.startsWith("res://")) continue;
        const file = this.project.files.get(reference.slice("res://".length));
        if (file && file.path !== target.path) related.set(file.path, file.source);
      }
    }
    return { source: target.source, related };
  }

  usages(): readonly SourceTarget[] {
    return [];
  }

  literalUsages(literal: string): readonly LiteralUsage[] {
    return this.project.targets
      .filter(
        (target) =>
          this.project.files.get(target.path)?.adapterId === this.adapterId &&
          this.sections(target).some((section) => section.strings.includes(literal)),
      )
      .map((target) => this.literalEvidence(target, literal));
  }

  private literalEvidence(target: SourceTarget, literal: string): LiteralUsage {
    const file = this.project.files.get(target.path);
    const sections = file ? resourceEvidence(file, literal) : [];
    const source = sections.map((section) => `${section.header}\n${section.body}`).join("\n\n");
    return {
      target,
      source,
      containsLiteral: (value) => sections.some((section) => section.strings.includes(value)),
      related: this.scriptDeclarations(sections),
    };
  }

  private sections(target: SourceTarget): readonly ResourceSection[] {
    const file = this.project.files.get(target.path);
    return file ? resourceSections(file) : [];
  }

  private scriptDeclarations(sections: readonly ResourceSection[]): EvidenceSource[] {
    return sections
      .filter((section) => section.kind === "ext_resource" && attribute(section, "type") === "Script")
      .flatMap((section) => {
        const reference = attribute(section, "path");
        if (!reference?.startsWith("res://")) return [];
        const path = reference.slice("res://".length);
        const schema = this.project.analysis.context(this.project, path).declarations?.(path);
        return schema ? [{ path, source: schema }] : [];
      });
  }
}
