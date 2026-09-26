import type { SourceFile } from "../../domain/source-target";
import { attribute, type ResourceSection, resourceSections } from "./parser";

export function sceneWiring(file: SourceFile): string {
  return resourceSections(file)
    .filter((entry) => ["gd_scene", "ext_resource", "node", "connection"].includes(entry.kind))
    .map((entry) => [entry.header, entry.body].filter(Boolean).join("\n"))
    .join("\n\n");
}

export function resourceEvidence(file: SourceFile, literal: string): readonly ResourceSection[] {
  const records = resourceSections(file);
  const selected = new Set(records.filter((entry) => entry.strings.includes(literal)));
  const ids = [...selected].flatMap((entry) => {
    const id = attribute(entry, "id");
    return id ? [id] : [];
  });
  for (const entry of records) {
    if (
      entry.kind === "sub_resource" &&
      entry.references.some((ref) => ref.kind === "sub_resource" && ids.includes(ref.id))
    )
      selected.add(entry);
  }
  for (const entry of selected) {
    for (const reference of entry.references) {
      const dependency = records.find(
        (record) => record.kind === reference.kind && attribute(record, "id") === reference.id,
      );
      if (dependency) selected.add(dependency);
    }
  }
  return records.filter((entry) => selected.has(entry));
}
