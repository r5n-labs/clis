import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

// ── Types ────────────────────────────────────────────────────────────

export type ScanOptions = {
  root: string;
  ignore: string[];
  maxDepth: number;
  includeStats: boolean;
  concurrency?: number;
  respectGitignore?: boolean;
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

export type IgnorePattern = {
  pattern: string;
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
};

// ── Semaphore (concurrency limiter) ──────────────────────────────────

function createSemaphore(max: number): {
  acquire: () => Promise<void>;
  release: () => void;
} {
  let current = 0;
  const waiting: Array<() => void> = [];

  return {
    acquire: () => {
      if (current < max) {
        current++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    },
    release: () => {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        current--;
      }
    },
  };
}

// ── Glob-to-regex conversion ─────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

export function globToRegex(glob: string, anchored: boolean): RegExp {
  let src = "";
  let i = 0;

  while (i < glob.length) {
    const c = glob[i]!;

    if (c === "*" && glob[i + 1] === "*") {
      // ** — match any path segments
      // skip trailing slash if present (e.g., **/)
      i += glob[i + 2] === "/" ? 3 : 2;
      src += "(?:.+/)?";
    } else if (c === "*") {
      // * — match anything except /
      i++;
      src += "[^/]*";
    } else if (c === "?") {
      // ? — match single char except /
      i++;
      src += "[^/]";
    } else {
      src += escapeRegex(c);
      i++;
    }
  }

  // If pattern has no slash and is not anchored, it can match at any depth
  const hasSlash = glob.includes("/");
  if (!hasSlash && !anchored) {
    return new RegExp(`(?:^|/)${src}$`);
  }

  // Anchored patterns match from the start of the relative path
  return new RegExp(`^${src}(?:$|/)`);
}

// ── .gitignore parsing ───────────────────────────────────────────────

export function parseGitignore(content: string, basePath: string): IgnorePattern[] {
  const patterns: IgnorePattern[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    let pattern = line;
    let negated = false;
    let directoryOnly = false;

    // Handle negation
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }

    // Handle directory-only patterns (trailing /)
    if (pattern.endsWith("/")) {
      directoryOnly = true;
      pattern = pattern.slice(0, -1);
    }

    // Handle leading slash (anchored to basePath)
    let anchored = false;
    if (pattern.startsWith("/")) {
      anchored = true;
      pattern = pattern.slice(1);
    }

    // Prepend basePath for non-root gitignore files
    const fullPattern = basePath ? `${basePath}/${pattern}` : pattern;
    const regex = globToRegex(fullPattern, anchored || basePath !== "");

    patterns.push({ pattern: fullPattern, regex, negated, directoryOnly });
  }

  return patterns;
}

function configPatternsToIgnorePatterns(ignore: string[]): IgnorePattern[] {
  return ignore.map((pattern) => ({
    pattern,
    regex: globToRegex(pattern, false),
    negated: false,
    directoryOnly: false,
  }));
}

// ── Pattern matching ─────────────────────────────────────────────────

export function shouldIgnore(
  relativePath: string,
  patterns: IgnorePattern[],
  isDirectory: boolean,
): boolean {
  let ignored = false;

  for (const p of patterns) {
    // Directory-only patterns only match directories
    if (p.directoryOnly && !isDirectory) continue;

    if (p.regex.test(relativePath)) {
      ignored = !p.negated;
    }
  }

  return ignored;
}

// ── .gitignore file reader ───────────────────────────────────────────

async function readGitignore(dirPath: string, rootPath: string): Promise<IgnorePattern[]> {
  const gitignorePath = join(dirPath, ".gitignore");
  try {
    const file = Bun.file(gitignorePath);
    const content = await file.text();
    const basePath = relative(rootPath, dirPath);
    return parseGitignore(content, basePath);
  } catch {
    return [];
  }
}

// ── Concurrent directory scanning ────────────────────────────────────

async function scanDirectory(
  dirPath: string,
  rootPath: string,
  accumulatedPatterns: IgnorePattern[],
  maxDepth: number,
  includeStats: boolean,
  currentDepth: number,
  semaphore: ReturnType<typeof createSemaphore>,
  respectGitignore: boolean,
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

  // Read .gitignore at this level if enabled
  let patterns = accumulatedPatterns;
  if (respectGitignore) {
    const gitignorePatterns = await readGitignore(dirPath, rootPath);
    if (gitignorePatterns.length > 0) {
      patterns = [...accumulatedPatterns, ...gitignorePatterns];
    }
  }

  await semaphore.acquire();
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } finally {
    semaphore.release();
  }

  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  // Separate directories and files for concurrent processing
  const dirs: Array<{ entry: typeof sorted[number]; fullPath: string; entryRelPath: string }> = [];
  const files: Array<{ entry: typeof sorted[number]; fullPath: string; entryRelPath: string }> = [];

  for (const entry of sorted) {
    const fullPath = join(dirPath, entry.name);
    const entryRelPath = relative(rootPath, fullPath);

    if (shouldIgnore(entryRelPath, patterns, entry.isDirectory())) continue;

    if (entry.isDirectory()) {
      dirs.push({ entry, fullPath, entryRelPath });
    } else if (entry.isFile()) {
      files.push({ entry, fullPath, entryRelPath });
    }
  }

  // Scan subdirectories concurrently
  const dirResults = await Promise.all(
    dirs.map((d) =>
      scanDirectory(
        d.fullPath,
        rootPath,
        patterns,
        maxDepth,
        includeStats,
        currentDepth + 1,
        semaphore,
        respectGitignore,
      ),
    ),
  );

  // Process files — concurrently when includeStats is true
  const fileNodes: FileNode[] = includeStats
    ? await Promise.all(
        files.map(async (f) => {
          const fileNode: FileNode = {
            name: f.entry.name,
            type: "file",
            path: f.entryRelPath,
          };
          const ext = extname(f.entry.name);
          if (ext) fileNode.extension = ext;

          await semaphore.acquire();
          try {
            fileNode.size = Bun.file(f.fullPath).size;
          } finally {
            semaphore.release();
          }

          return fileNode;
        }),
      )
    : files.map((f) => {
        const fileNode: FileNode = {
          name: f.entry.name,
          type: "file",
          path: f.entryRelPath,
        };
        const ext = extname(f.entry.name);
        if (ext) fileNode.extension = ext;
        return fileNode;
      });

  // Reassemble in sorted order: directories first, then files
  node.children = [...dirResults, ...fileNodes];

  return node;
}

// ── Tree utilities ───────────────────────────────────────────────────

export function countNodes(node: FileNode): { files: number; directories: number } {
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

export function collectExtensions(node: FileNode): Record<string, number> {
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

// ── Public API ───────────────────────────────────────────────────────

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const {
    root,
    ignore,
    maxDepth,
    includeStats,
    concurrency = 32,
    respectGitignore = true,
  } = options;

  const semaphore = createSemaphore(concurrency);
  const configPatterns = configPatternsToIgnorePatterns(ignore);

  const tree = await scanDirectory(
    root,
    root,
    configPatterns,
    maxDepth,
    includeStats,
    0,
    semaphore,
    respectGitignore,
  );

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
