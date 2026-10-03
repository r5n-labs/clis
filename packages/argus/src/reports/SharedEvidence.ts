import { Exit } from "@r5n/cli-core";
import { object, string } from "banditypes";
import { record, textValue } from "../config/validation";
import type { ReviewContext } from "../domain/review-plan";
import { fingerprint } from "../storage/fingerprints";
import type { Report } from "./report-data";

export type EvidenceFragment = { path: string; source: string };
export type ReferencedContext = Omit<ReviewContext, "source" | "related"> & {
  sourceId: string;
  related: { path: string; evidenceId: string }[];
};
const parseFragment = object<EvidenceFragment>({ path: textValue, source: string() });

export class SharedEvidence {
  readonly fragments: Record<string, EvidenceFragment> = {};
  readonly contexts: Record<string, ReferencedContext>;

  constructor(contexts: Report["contexts"]) {
    this.contexts = Object.fromEntries(
      Object.entries(contexts).map(([id, { source, related, ...context }]) => [
        id,
        {
          ...context,
          sourceId: this.add({ path: context.path, source }),
          related: related.map((entry) => ({ path: entry.path, evidenceId: this.add(entry) })),
        },
      ]),
    );
  }

  private add(fragment: EvidenceFragment): string {
    const id = fingerprint(fragment);
    this.fragments[id] ??= fragment;
    return id;
  }
}

export function restoreEvidence(value: unknown, evidence: unknown): Record<string, unknown> {
  const report = record(value, "snapshot report");
  const fragments = record(evidence, "snapshot evidence");
  const resolve = (id: unknown, path: unknown): string => {
    const key = textValue(id);
    if (!Object.hasOwn(fragments, key)) throw new Exit(`Missing snapshot evidence: ${key}`);
    const fragment = parseFragment(fragments[key]);
    if (fragment.path !== path || fingerprint(fragment) !== key) throw new Exit(`Invalid snapshot evidence: ${key}`);
    return fragment.source;
  };
  const contexts = Object.fromEntries(
    Object.entries(record(report.contexts, "snapshot contexts")).map(([id, value]) => {
      const { sourceId, related, ...context } = record(value, "context");
      if (!Array.isArray(related)) throw new Exit("Invalid related context");
      return [
        id,
        {
          ...context,
          source: resolve(sourceId, context.path),
          related: related.map((value) => {
            const { evidenceId, ...entry } = record(value, "related context");
            return { ...entry, source: resolve(evidenceId, entry.path) };
          }),
        },
      ];
    }),
  );
  return { ...report, contexts };
}
