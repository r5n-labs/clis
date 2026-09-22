import type { EvidenceSink, ReviewContextContributor } from "../../analysis/contracts";
import type { Project, SourceTarget } from "../../domain/source-target";

const MAX_USAGE_EXAMPLES = 3;

export class TranslationEvidence implements ReviewContextContributor {
  supports(target: SourceTarget): boolean {
    return target.group === "translations";
  }

  contribute(project: Project, target: SourceTarget, evidence: EvidenceSink): void {
    const identity = target.translation;
    if (!identity) return;
    for (const candidate of project.targets) {
      if (
        candidate.group === "translations" &&
        candidate.path !== target.path &&
        candidate.translation?.id === identity.id &&
        candidate.translation.context === identity.context
      )
        evidence.add(
          candidate.path,
          `Parallel catalogue entry; the locale is described by its header, not assumed to be the source language:\n${candidate.source}`,
        );
    }
    const usages = project.analysis.literalUsages(project, identity.id);
    let included = 0;
    for (const usage of usages) {
      if (included === MAX_USAGE_EXAMPLES) break;
      const { target: site, source } = usage;
      if (
        !evidence.add(
          site.path,
          `Literal translation-key usage (not proof of runtime localisation; selected resource records only):\n${source}`,
        )
      )
        continue;
      included++;
      for (const entry of usage.related) evidence.add(entry.path, entry.source);
      for (const entry of project.targets) {
        if (
          entry.group !== "translations" ||
          entry.path !== target.path ||
          !entry.translation ||
          entry.id === target.id
        )
          continue;
        if (usage.containsLiteral(entry.translation.id))
          evidence.add(entry.path, `Other text used by the same method/resource:\n${entry.source}`);
      }
    }
    evidence.note(
      `Translation usage: ${included} of ${usages.length} literal-key sites supplied. Computed keys and runtime-selected contexts are not resolved; do not infer UI meaning from the identifier alone.`,
    );
  }
}
