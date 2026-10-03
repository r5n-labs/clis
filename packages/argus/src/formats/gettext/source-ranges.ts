import { Exit } from "@r5n/cli-core";
import { ONE_BASED_LINE } from "../../constants";

type SourceRange = { source: string; line: number; endLine: number };

export function* entryRanges(path: string, source: string): Generator<SourceRange> {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  let start = 0;
  let hasId = false;
  let prefix: number | undefined;
  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (text.startsWith("#~")) {
      if (hasId) {
        const range = sourceRange(lines, start, prefix ?? index);
        if (range) yield range;
      }
      start = index + ONE_BASED_LINE;
      hasId = false;
      prefix = undefined;
      continue;
    }
    if (!text || text.startsWith("#")) {
      prefix ??= index;
      continue;
    }
    if (!/^(?:"|msg(?:ctxt|id(?:_plural)?|str(?:\[\d+\])?)\s)/.test(text))
      throw new Exit(`Unsupported or invalid gettext syntax in ${path}:${index + ONE_BASED_LINE}`);
    const beginsEntry = /^msg(?:ctxt|id)\s/.test(text);
    if (beginsEntry && hasId) {
      const end = prefix ?? index;
      const range = sourceRange(lines, start, end);
      if (range) yield range;
      start = end;
      hasId = false;
    }
    if (/^msgid\s/.test(text)) hasId = true;
    prefix = undefined;
  }
  const range = sourceRange(lines, start, lines.length);
  if (range) yield range;
}

function sourceRange(lines: string[], from: number, until: number): SourceRange | undefined {
  let start = from;
  let end = until;
  while (start < end && !lines[start]?.trim()) start++;
  while (end > start && !lines[end - ONE_BASED_LINE]?.trim()) end--;
  if (start === end) return undefined;
  return { source: lines.slice(start, end).join("\n"), line: start + ONE_BASED_LINE, endLine: end };
}
