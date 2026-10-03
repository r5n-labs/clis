import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { FileMode } from "../domain/source-target";

const OWNER_EXECUTABLE = 0o100;

export function matches(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(path));
}

export function isExcluded(path: string, patterns: readonly string[]): boolean {
  const parts = path.replace(/\/$/, "").split("/");
  return parts.some((_, index) => {
    const ancestor = parts.slice(0, index + 1).join("/");
    return matches(ancestor, patterns) || matches(`${ancestor}/`, patterns);
  });
}

export function* projectPaths(root: string, exclude: readonly string[], directory = ""): Generator<string> {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || isExcluded(path, exclude)) continue;
    if (entry.isDirectory()) yield* projectPaths(root, exclude, path);
    else if (entry.isFile()) yield path;
  }
}

export function readProjectFile(root: string, path: string): { source: string; mode: FileMode } {
  const { bytes, mode } = readProjectContents(root, path);
  return { source: bytes.toString("utf8"), mode };
}

export function readProjectBytes(root: string, path: string): Buffer {
  return readProjectContents(root, path).bytes;
}

function readProjectContents(root: string, path: string): { bytes: Buffer; mode: FileMode } {
  const absolute = resolve(root, path);
  const resolved = realpathSync(absolute);
  const rel = relative(realpathSync(root), resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || lstatSync(absolute).isSymbolicLink())
    throw new Exit(`Source escapes project or is a symlink: ${path}`);
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return {
      bytes: readFileSync(descriptor),
      mode: fstatSync(descriptor).mode & OWNER_EXECUTABLE ? "100755" : "100644",
    };
  } finally {
    closeSync(descriptor);
  }
}
