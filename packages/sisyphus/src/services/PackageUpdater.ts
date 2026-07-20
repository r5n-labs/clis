import { readFile, writeFile } from "node:fs/promises";
import type { Package } from "../domain";

const DEFAULT_INDENT = 2;
const TOP_LEVEL_DEPTH = 1;
const VERSION_KEY = '"version"';

export class PackageUpdater {
  private originals = new Map<string, string>();

  async updateAll(packages: Package[]) {
    this.originals.clear();

    for (const pkg of packages) {
      await this.updatePackage(pkg);
    }
  }

  async rollback() {
    for (const [file, content] of this.originals) {
      await writeFile(file, content, "utf-8");
    }
    this.originals.clear();
  }

  private async updatePackage(pkg: Package) {
    const newVersion = pkg.newVersion;
    if (!newVersion) return;

    const content = await readFile(pkg.file, "utf-8");
    this.originals.set(pkg.file, content);

    await writeFile(pkg.file, replaceVersion(content, newVersion), "utf-8");
  }
}

export function replaceVersion(content: string, newVersion: string): string {
  const span = findTopLevelVersionSpan(content);

  if (!span) return rewriteManifest(content, newVersion);

  return `${content.slice(0, span.start)}${JSON.stringify(newVersion)}${content.slice(span.end)}`;
}

function findTopLevelVersionSpan(content: string): { start: number; end: number } | null {
  let depth = 0;
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === '"') {
      const stringEnd = scanString(content, index);
      const isTopLevelVersionKey =
        depth === TOP_LEVEL_DEPTH && content.slice(index, stringEnd) === VERSION_KEY && !insideArray(content, index);

      if (isTopLevelVersionKey) {
        const valueStart = skipToValue(content, stringEnd);
        if (valueStart !== null && content[valueStart] === '"') {
          return { end: scanString(content, valueStart), start: valueStart };
        }
        return null;
      }

      index = stringEnd;
      continue;
    }

    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
    index += 1;
  }

  return null;
}

function scanString(content: string, start: number): number {
  let index = start + 1;

  while (index < content.length) {
    if (content[index] === "\\") {
      index += 2;
      continue;
    }
    if (content[index] === '"') return index + 1;
    index += 1;
  }

  return index;
}

function skipToValue(content: string, afterKey: number): number | null {
  let index = afterKey;

  while (index < content.length && /\s/.test(content[index] ?? "")) index += 1;
  if (content[index] !== ":") return null;
  index += 1;
  while (index < content.length && /\s/.test(content[index] ?? "")) index += 1;

  return index;
}

function insideArray(content: string, position: number): boolean {
  const stack: string[] = [];
  let index = 0;

  while (index < position) {
    const char = content[index];

    if (char === '"') {
      index = scanString(content, index);
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    if (char === "}" || char === "]") stack.pop();
    index += 1;
  }

  return stack[stack.length - 1] === "[";
}

function rewriteManifest(content: string, newVersion: string): string {
  const json = JSON.parse(content);
  json.version = newVersion;
  return `${JSON.stringify(json, null, detectIndent(content))}\n`;
}

function detectIndent(content: string): string | number {
  const match = content.match(/^[\t ]+/m);
  return match ? match[0] : DEFAULT_INDENT;
}
