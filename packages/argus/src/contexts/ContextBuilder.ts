import { Exit } from "@r5n/cli-core";
import { MAX_REQUEST_BYTES } from "../constants";
import type { Question } from "../domain/question";
import type { ReviewContext } from "../domain/review-plan";
import type { Project, SourceTarget } from "../domain/source-target";
import { SupportingContext } from "./SupportingContext";

const EXPANDED_SOURCE_BYTES = 85_000;
const SUPPORTING_BYTES = 16_000;
const ENVELOPE_RESERVE_BYTES = 2_000;

export class ContextBuilder {
  constructor(
    private readonly project: Project,
    private readonly requestBytes = MAX_REQUEST_BYTES,
  ) {}

  build(target: SourceTarget, question: Question, expanded = false): ReviewContext {
    const file = this.project.files.get(target.path);
    const references = this.project.analysis.context(this.project, target.path).references;
    const prepared = this.project.analysis.prepareTarget(this.project, target, question.context, this.requestBytes);
    const selectedTarget = prepared.target;
    const mode = expanded && question.context !== "file" ? "references" : question.context;
    const changeNotes = [...prepared.notes];
    const related = new Map<string, string>();
    let source = selectedTarget.source;
    let unresolved: ReviewContext["unresolved"];
    let referenceScope: string | undefined;
    if (mode === "file" && target.group !== "changes") source = file?.source ?? source;
    if (mode === "target") source = [target.documentation, target.comments, target.source].filter(Boolean).join("\n");
    if (mode === "class" || mode === "references" || mode === "file") {
      const selection =
        target.group === "changes"
          ? undefined
          : references?.select(selectedTarget, {
              depth: mode === "class" ? 0 : expanded ? 2 : 1,
              fixtures: this.isTest(target),
              sourceBytes: expanded ? EXPANDED_SOURCE_BYTES : undefined,
            });
      if (selection) {
        if (mode !== "file") source = selection.source;
        for (const [path, text] of selection.related) related.set(path, text);
        unresolved = selection.unresolved;
        referenceScope = selection.scope;
      } else if (mode === "references") {
        if (target.changeContext) this.changeReferences(target, question, related, changeNotes, expanded);
      }
    }
    const { reviewQueues: _reviewQueues, ...contextQuestion } = question;
    const usedBytes = Buffer.byteLength(
      JSON.stringify({ source, related: [...related], unresolved, question: contextQuestion }),
    );
    const support = new SupportingContext(
      Math.min(SUPPORTING_BYTES, Math.max(0, this.requestBytes - usedBytes - ENVELOPE_RESERVE_BYTES)),
    );
    support.notes.push(...changeNotes);
    this.project.analysis.contribute(this.project, target, support);
    if (mode === "references" || mode === "file")
      this.project.analysis.frameworkEvidence(this.project, target, support);
    if (expanded && references && (target.group === "methods" || target.group === "tests"))
      support.usages(target, references);
    for (const [path, text] of support.related)
      related.set(path, [related.get(path), text].filter(Boolean).join("\n\n"));
    this.addExplicitFiles(target, question, related);
    return {
      language: file?.language ?? target.changeContext?.before.files.get(target.path)?.language ?? "Text",
      path: target.path,
      source,
      related: [...related].sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => ({ path, source: text })),
      ...(unresolved?.length ? { unresolved } : {}),
      ...(referenceScope ? { referenceScope } : {}),
      ...(support.notes.length ? { notes: [...new Set(support.notes)] } : {}),
    };
  }

  private isTest(target: SourceTarget): boolean {
    return (
      target.group === "tests" ||
      (this.project.files
        .get(target.path)
        ?.targets.some(
          (entry) => entry.group === "tests" && entry.owner === target.owner && entry.name === target.name,
        ) ??
        false)
    );
  }

  private addExplicitFiles(target: SourceTarget, question: Question, related: Map<string, string>): void {
    for (const pattern of question.contextFiles) {
      const matches = [...this.project.files.values()].filter((entry) => new Bun.Glob(pattern).match(entry.path));
      if (!matches.length) throw new Exit(`Context pattern ${pattern} for ${question.id} matched no readable files`);
      for (const match of matches) if (match.path !== target.path) related.set(match.path, match.source);
    }
  }

  private changeReferences(
    target: SourceTarget,
    question: Question,
    related: Map<string, string>,
    notes: string[],
    expanded: boolean,
  ): void {
    if (!target.changeContext) return;
    for (const [version, project] of Object.entries(target.changeContext)) {
      const file = project.files.get(target.path);
      const root = file?.targets.find((entry) => entry.group === "files" || entry.group === "resources");
      if (!root) continue;
      const context = new ContextBuilder(project, this.requestBytes).build(
        root,
        { ...question, context: "references", contextFiles: [] },
        expanded,
      );
      for (const entry of context.related)
        related.set(`${version}:${entry.path}`, `Dependency from the ${version} version:\n${entry.source}`);
      for (const gap of context.unresolved ?? [])
        notes.push(`${version}:${gap.path}: unresolved ${gap.expressions.join(", ")}`);
    }
    notes.push(
      "Before dependencies come from the baseline commit; after dependencies come from the working tree. Callers, runtime configuration and intentional contract changes may still be missing.",
    );
  }
}
