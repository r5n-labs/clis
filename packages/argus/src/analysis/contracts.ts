import type { ContextMode } from "../domain/question";
import type { ReviewContext } from "../domain/review-plan";
import type { Project, SourceFile, SourceTarget } from "../domain/source-target";

export type EvidenceSource = { path: string; source: string };
export interface EvidenceSink {
  add(path: string, source: string): boolean;
  note(message: string): void;
}

export type ReferenceOptions = { depth?: number; fixtures?: boolean; sourceBytes?: number };
export type ReferenceSelection = {
  source: string;
  related: ReadonlyMap<string, string>;
  unresolved?: ReviewContext["unresolved"];
  scope?: string;
};
export interface ReferenceProvider {
  select(target: SourceTarget, options: ReferenceOptions): ReferenceSelection | undefined;
  usages(target: SourceTarget): readonly SourceTarget[];
}

export type LiteralUsage = {
  target: SourceTarget;
  source: string;
  containsLiteral(literal: string): boolean;
  related: readonly EvidenceSource[];
};
export type SourceCapabilities = {
  references?: ReferenceProvider;
  literalUsages?: (literal: string) => readonly LiteralUsage[];
  declarations?: (path: string) => string | undefined;
};

export abstract class SourceAdapter {
  abstract readonly id: string;
  abstract readonly language: string;
  abstract supports(path: string): boolean;
  abstract parse(path: string, source: string): Promise<SourceFile>;
  abstract createContext(project: Project): SourceCapabilities;

  protected sourceFile(content: Omit<SourceFile, "adapterId" | "language">): SourceFile {
    return { ...content, adapterId: this.id, language: this.language };
  }
}

export interface FrameworkIntegration {
  readonly id: string;
  readonly configurationFiles: readonly string[];
  contribute(project: Project, target: SourceTarget, evidence: EvidenceSink): void;
}

export interface ReviewContextContributor {
  supports(target: SourceTarget): boolean;
  contribute(project: Project, target: SourceTarget, evidence: EvidenceSink): void;
}

export type PreparedTarget = { target: SourceTarget; notes: readonly string[] };
export interface TargetContextPolicy {
  supports(target: SourceTarget, mode: ContextMode): boolean;
  prepare(project: Project, target: SourceTarget, budget: number): PreparedTarget;
}

export interface AnalysisServices {
  needsFile(path: string): boolean;
  parse(path: string, source: string): Promise<SourceFile>;
  context(project: Project, path: string): SourceCapabilities;
  prepareTarget(project: Project, target: SourceTarget, mode: ContextMode, budget: number): PreparedTarget;
  literalUsages(project: Project, literal: string): readonly LiteralUsage[];
  contribute(project: Project, target: SourceTarget, evidence: EvidenceSink): void;
  frameworkEvidence(project: Project, target: SourceTarget, evidence: EvidenceSink): void;
}
