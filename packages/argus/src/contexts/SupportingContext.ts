import type { EvidenceSink, ReferenceProvider } from "../analysis/contracts";
import type { SourceTarget } from "../domain/source-target";

const MAX_USAGE_EXAMPLES = 3;

export class SupportingContext implements EvidenceSink {
  readonly related = new Map<string, string>();
  readonly notes: string[] = [];
  private bytes = 0;

  constructor(private readonly budget: number) {}

  usages(target: SourceTarget, references: ReferenceProvider): void {
    const callers = references.usages(target).filter((caller) => caller.id !== target.id);
    let included = 0;
    for (const caller of callers) {
      if (included === MAX_USAGE_EXAMPLES) break;
      const context = references.select(caller, { depth: 0 });
      const source = `Usage example: ${caller.owner}.${caller.name}\n${context?.source ?? caller.source}`;
      if (this.add(caller.path, source)) included++;
    }
    this.notes.push(
      `Usage sample: ${included} of ${callers.length} statically resolved callers. Complete caller bodies show argument preparation and result use; examples do not establish all callers or runtime dispatch.`,
    );
  }

  note(message: string): void {
    this.notes.push(message);
  }

  add(path: string, source: string): boolean {
    if (this.related.get(path)?.includes(source)) return true;
    const bytes = Buffer.byteLength(source);
    if (this.bytes + bytes > this.budget) {
      this.notes.push(`Supporting evidence omitted by the ${this.budget}-byte allowance: ${path}.`);
      return false;
    }
    this.bytes += bytes;
    this.related.set(path, [this.related.get(path), source].filter(Boolean).join("\n\n"));
    return true;
  }
}
