import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export type ScanOptions = {
  root: string;
  ignore: string[];
  maxDepth: number;
  includeStats: boolean;
};

export type FileNode = {
  name: string;
  type: "file" | "directory";
  path: string;
  children?: FileNode[];
  size?: number;
  extension?: string;
};

export type ScanResult = {
  root: string;
  generatedAt: string;
  totalFiles: number;
  totalDirectories: number;
  tree: FileNode;
  extensions?: Record<string, number>;
};

function shouldIgnore(name: string, ignore: string[]): boolean {
  return ignore.some((pattern) => name === pattern || name.includes(pattern));
}

async function scanDirectory(
  dirPath: string,
  rootPath: string,
  ignore: string[],
  maxDepth: number,
  includeStats: boolean,
  currentDepth: number,
): Promise<FileNode> {
  const name = dirPath === rootPath ? "." : dirPath.split("/").pop() ?? "";
  const relativePath = relative(rootPath, dirPath) || ".";

  const node: FileNode = {
    name,
    type: "directory",
    path: relativePath,
    children: [],
  };

  if (currentDepth >= maxDepth) return node;

  const entries = await readdir(dirPath, { withFileTypes: true });
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (shouldIgnore(entry.name, ignore)) continue;

    const fullPath = join(dirPath, entry.name);
    const entryRelativePath = relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      const child = await scanDirectory(fullPath, rootPath, ignore, maxDepth, includeStats, currentDepth + 1);
      node.children!.push(child);
    } else if (entry.isFile()) {
      const fileNode: FileNode = {
        name: entry.name,
        type: "file",
        path: entryRelativePath,
      };

      const ext = extname(entry.name);
      if (ext) fileNode.extension = ext;

      if (includeStats) {
        const file = Bun.file(fullPath);
        fileNode.size = file.size;
      }

      node.children!.push(fileNode);
    }
  }

  return node;
}

function countNodes(node: FileNode): { files: number; directories: number } {
  if (node.type === "file") return { files: 1, directories: 0 };

  let files = 0;
  let directories = 1;

  for (const child of node.children ?? []) {
    const counts = countNodes(child);
    files += counts.files;
    directories += counts.directories;
  }

  return { files, directories };
}

function collectExtensions(node: FileNode): Record<string, number> {
  const counts: Record<string, number> = {};

  if (node.type === "file" && node.extension) {
    counts[node.extension] = 1;
    return counts;
  }

  for (const child of node.children ?? []) {
    const childCounts = collectExtensions(child);
    for (const [ext, count] of Object.entries(childCounts)) {
      counts[ext] = (counts[ext] ?? 0) + count;
    }
  }

  return counts;
}

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const { root, ignore, maxDepth, includeStats } = options;

  const tree = await scanDirectory(root, root, ignore, maxDepth, includeStats, 0);
  const { files, directories } = countNodes(tree);
  const extensions = includeStats ? collectExtensions(tree) : undefined;

  const sortedExtensions = extensions
    ? Object.fromEntries(Object.entries(extensions).sort(([, a], [, b]) => b - a))
    : undefined;

  return {
    root,
    generatedAt: new Date().toISOString(),
    totalFiles: files,
    totalDirectories: directories - 1,
    tree,
    extensions: sortedExtensions,
  };
}
