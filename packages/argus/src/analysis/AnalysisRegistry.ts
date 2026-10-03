import { Exit } from "@r5n/cli-core";
import type { ContextMode } from "../domain/question";
import type { Project, SourceFile, SourceTarget } from "../domain/source-target";
import type {
  AnalysisServices,
  EvidenceSink,
  FrameworkIntegration,
  LiteralUsage,
  PreparedTarget,
  ReviewContextContributor,
  SourceAdapter,
  SourceCapabilities,
  TargetContextPolicy,
} from "./contracts";

type Registration = {
  adapters: readonly SourceAdapter[];
  fallback: SourceAdapter;
  frameworks: readonly FrameworkIntegration[];
  reviews: readonly ReviewContextContributor[];
  policies: readonly TargetContextPolicy[];
};

export class AnalysisRegistry implements AnalysisServices {
  private readonly adapters: readonly SourceAdapter[];
  private readonly fallback: SourceAdapter;
  private readonly frameworks: readonly FrameworkIntegration[];
  private readonly reviews: readonly ReviewContextContributor[];
  private readonly policies: readonly TargetContextPolicy[];
  private readonly contexts = new WeakMap<Project, Map<string, SourceCapabilities>>();

  constructor(registration: Registration) {
    this.adapters = [...registration.adapters];
    this.fallback = registration.fallback;
    this.frameworks = [...registration.frameworks];
    this.reviews = [...registration.reviews];
    this.policies = [...registration.policies];
    const ids = [...this.adapters, this.fallback].map((adapter) => adapter.id);
    if (new Set(ids).size !== ids.length) throw new Exit("Duplicate source adapter IDs");
    const frameworks = this.frameworks.map((framework) => framework.id);
    if (new Set(frameworks).size !== frameworks.length) throw new Exit("Duplicate framework integration IDs");
  }

  needsFile(path: string): boolean {
    return this.frameworks.some((framework) => framework.configurationFiles.includes(path));
  }

  async parse(path: string, source: string): Promise<SourceFile> {
    const candidates = this.adapters.filter((adapter) => adapter.supports(path));
    if (candidates.length > 1) throw new Exit(`Multiple source adapters claim ${path}`);
    const adapter = candidates[0] ?? this.fallback;
    const file = await adapter.parse(path, source);
    if (
      file.path !== path ||
      file.source !== source ||
      file.adapterId !== adapter.id ||
      file.language !== adapter.language ||
      file.targets.some((target) => target.path !== path)
    )
      throw new Exit(`Source adapter ${adapter.id} returned inconsistent file identity for ${path}`);
    return file;
  }

  context(project: Project, path: string): SourceCapabilities {
    const id = project.files.get(path)?.adapterId;
    if (!id) return {};
    const adapter = [...this.adapters, this.fallback].find((entry) => entry.id === id);
    if (!adapter) throw new Exit(`No source adapter registered for ${id}`);
    let contexts = this.contexts.get(project);
    if (!contexts) {
      contexts = new Map();
      this.contexts.set(project, contexts);
    }
    const cached = contexts.get(id);
    if (cached) return cached;
    const context = adapter.createContext(project);
    contexts.set(id, context);
    return context;
  }

  literalUsages(project: Project, literal: string): readonly LiteralUsage[] {
    const visited = new Set<string>();
    const usages: LiteralUsage[] = [];
    for (const file of project.files.values()) {
      if (visited.has(file.adapterId)) continue;
      visited.add(file.adapterId);
      usages.push(...(this.context(project, file.path).literalUsages?.(literal) ?? []));
    }
    const positions = new Map(project.targets.map((target, index) => [target.id, index]));
    return usages.sort((a, b) => (positions.get(a.target.id) ?? 0) - (positions.get(b.target.id) ?? 0));
  }

  prepareTarget(project: Project, target: SourceTarget, mode: ContextMode, budget: number): PreparedTarget {
    const policies = this.policies.filter((policy) => policy.supports(target, mode));
    if (policies.length > 1) throw new Exit(`Multiple context policies claim ${target.id} in ${mode} context`);
    const prepared = policies[0]?.prepare(project, target, budget) ?? { target, notes: [] };
    if (
      prepared.target.id !== target.id ||
      prepared.target.path !== target.path ||
      prepared.target.group !== target.group
    )
      throw new Exit(`Context policy changed target identity for ${target.id}`);
    return prepared;
  }

  contribute(project: Project, target: SourceTarget, evidence: EvidenceSink): void {
    for (const review of this.reviews) if (review.supports(target)) review.contribute(project, target, evidence);
  }

  frameworkEvidence(project: Project, target: SourceTarget, evidence: EvidenceSink): void {
    for (const framework of this.frameworks) framework.contribute(project, target, evidence);
  }
}
