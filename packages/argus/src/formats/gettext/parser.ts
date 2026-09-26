import { Exit } from "@r5n/cli-core";
import { po } from "gettext-parser";
import type { SourceTarget } from "../../domain/source-target";
import { entryRanges } from "./source-ranges";

export function translationTargets(path: string, source: string): SourceTarget[] {
  const ranges = [...entryRanges(path, source)];
  const catalogue = parseCatalogue(path, source, true);
  const metadata = catalogue.translations[""]?.[""]?.msgstr[0] ?? "";
  const targets: SourceTarget[] = [];
  for (const range of ranges) {
    const entries = Object.values(parseCatalogue(path, range.source, false).translations).flatMap(Object.values);
    const translations = entries.filter((entry) => entry.msgid !== "");
    if (!translations.length) continue;
    if (translations.length !== 1) throw new Exit(`Cannot locate gettext entry in ${path}:${range.line}`);
    const entry = translations[0];
    if (!entry) continue;
    const name = `${entry.msgctxt ?? ""}:${entry.msgid}`;
    targets.push({
      id: `translations:${JSON.stringify([path, entry.msgctxt ?? "", entry.msgid])}`,
      group: "translations",
      path,
      owner: path,
      name,
      line: range.line,
      endLine: range.endLine,
      source: [metadata, range.source.trim()].filter(Boolean).join("\n"),
      comments: "",
      declarations: [],
      references: [],
      calls: [],
      translation: { id: entry.msgid, context: entry.msgctxt ?? "" },
    });
  }
  return targets;
}

function parseCatalogue(path: string, source: string, validation: boolean) {
  try {
    return po.parse(source, { validation });
  } catch (error) {
    const line =
      error instanceof Error && "lineNumber" in error && typeof error.lineNumber === "number" ? error.lineNumber : 1;
    const reason = error instanceof Error ? error.message : "Invalid catalogue";
    throw new Exit(`Unsupported or invalid gettext syntax in ${path}:${line}`, reason);
  }
}
