import type { PreparedTarget, TargetContextPolicy } from "../../analysis/contracts";
import type { ContextMode } from "../../domain/question";
import type { Project, SourceTarget } from "../../domain/source-target";
import { architectureTarget } from "./overview";

export class ArchitectureContextPolicy implements TargetContextPolicy {
  supports(target: SourceTarget, mode: ContextMode): boolean {
    return target.group === "classes" && (mode === "class" || mode === "references");
  }

  prepare(project: Project, target: SourceTarget, budget: number): PreparedTarget {
    const prepared = architectureTarget(target, project.files.get(target.path), budget);
    return {
      target: prepared,
      notes:
        prepared === target
          ? []
          : [
              "Partial architecture overview: declarations, dependency inventory and complete selected methods replace the oversized class body. Omitted code remains covered by the full-source fingerprint. This is candidate discovery, not a complete architecture audit.",
            ],
    };
  }
}
