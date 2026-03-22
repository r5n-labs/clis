import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Cancel, args, color, log, note, select, spinner, text } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { type FileNode, type ScanResult, scan } from "../services/CodebaseScanner";

const exploreArgs = args({
  path: { alias: "p", description: "Starting directory path", type: "string" },
  depth: { alias: "d", description: "Max scan depth", type: "number" },
});

type ExploreCtx = Ctx<typeof exploreArgs>;

const ACTION_BACK = "__back__";
const ACTION_SEARCH = "__search__";
const ACTION_STATS = "__stats__";
const SEARCH_BACK = "__search_back__";
const PREVIEW_LINE_LIMIT = 50;

export function collectAllFiles(node: FileNode): FileNode[] {
  if (node.type === "file") return [node];

  const files: FileNode[] = [];
  for (const child of node.children ?? []) {
    files.push(...collectAllFiles(child));
  }
  return files;
}

export function collectExtensionCounts(node: FileNode): Record<string, number> {
  const counts: Record<string, number> = {};

  if (node.type === "file" && node.extension) {
    counts[node.extension] = 1;
    return counts;
  }

  for (const child of node.children ?? []) {
    const childCounts = collectExtensionCounts(child);
    for (const [ext, count] of Object.entries(childCounts)) {
      counts[ext] = (counts[ext] ?? 0) + count;
    }
  }

  return counts;
}

export function countChildren(node: FileNode): { files: number; dirs: number } {
  let files = 0;
  let dirs = 0;

  for (const child of node.children ?? []) {
    if (child.type === "directory") {
      dirs++;
    } else {
      files++;
    }
  }

  return { files, dirs };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildOptions(
  node: FileNode,
  canGoBack: boolean,
): { options: { label: string; value: string; hint?: string }[]; childMap: Map<string, FileNode> } {
  const options: { label: string; value: string; hint?: string }[] = [];
  const childMap = new Map<string, FileNode>();

  if (canGoBack) {
    options.push({
      label: color.dim(".."),
      value: ACTION_BACK,
      hint: "go up",
    });
  }

  options.push({
    label: color.cyan("Search"),
    value: ACTION_SEARCH,
    hint: "find files by name",
  });

  options.push({
    label: color.magenta("Stats"),
    value: ACTION_STATS,
    hint: "directory statistics",
  });

  for (const child of node.children ?? []) {
    const key = child.path;
    childMap.set(key, child);

    if (child.type === "directory") {
      const { files, dirs } = countChildren(child);
      const parts: string[] = [];
      if (dirs > 0) parts.push(`${dirs} dir${dirs > 1 ? "s" : ""}`);
      if (files > 0) parts.push(`${files} file${files > 1 ? "s" : ""}`);

      options.push({
        label: color.blue(`${child.name}/`),
        value: key,
        hint: parts.join(", ") || "empty",
      });
    } else {
      const sizeHint = child.size != null ? formatSize(child.size) : undefined;
      options.push({
        label: color.green(child.name),
        value: key,
        hint: [child.extension, sizeHint].filter(Boolean).join(" | ") || undefined,
      });
    }
  }

  return { options, childMap };
}

async function showFilePreview(rootPath: string, fileNode: FileNode): Promise<void> {
  const fullPath = resolve(rootPath, fileNode.path);

  try {
    const content = await readFile(fullPath, "utf-8");
    const allLines = content.split("\n");
    const lines = allLines.slice(0, PREVIEW_LINE_LIMIT);
    const preview = lines.join("\n");
    const truncated = allLines.length > PREVIEW_LINE_LIMIT;

    const header = [
      `${color.bold("File:")} ${fileNode.path}`,
      fileNode.extension ? `${color.bold("Type:")} ${fileNode.extension}` : null,
      fileNode.size != null ? `${color.bold("Size:")} ${formatSize(fileNode.size)}` : null,
      truncated ? color.dim(`(showing first ${PREVIEW_LINE_LIMIT} of ${allLines.length} lines)`) : null,
    ]
      .filter(Boolean)
      .join("\n");

    note(`${header}\n${color.dim("\u2500".repeat(50))}\n${preview}`);
  } catch {
    log.error(`Could not read file: ${fullPath}`);
  }
}

function showStats(scanResult: ScanResult, currentNode: FileNode): void {
  const extensions = collectExtensionCounts(currentNode);
  const sorted = Object.entries(extensions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  const extLines =
    sorted.length > 0
      ? sorted.map(([ext, count]) => `  ${color.green(ext.padEnd(12))} ${count}`).join("\n")
      : color.dim("  (no files)");

  const { files, dirs } = countChildren(currentNode);
  const allFiles = collectAllFiles(currentNode);

  const statsText = [
    `${color.bold("Current directory:")} ${currentNode.path}`,
    "",
    `${color.bold("Direct children:")}`,
    `  Directories: ${color.blue(String(dirs))}`,
    `  Files:       ${color.green(String(files))}`,
    "",
    `${color.bold("Recursive totals:")}`,
    `  Total files: ${color.green(String(allFiles.length))}`,
    "",
    `${color.bold("Scan totals:")}`,
    `  Files:       ${color.green(String(scanResult.totalFiles))}`,
    `  Directories: ${color.blue(String(scanResult.totalDirectories))}`,
    "",
    `${color.bold("Top extensions:")}`,
    extLines,
  ].join("\n");

  note(statsText);
}

async function searchFiles(rootPath: string, rootNode: FileNode, query: string): Promise<void> {
  const allFiles = collectAllFiles(rootNode);
  const lowerQuery = query.toLowerCase();
  const matches = allFiles.filter((f) => f.name.toLowerCase().includes(lowerQuery));

  if (matches.length === 0) {
    log.warn(`No files matching "${query}"`);
    return;
  }

  log.info(`Found ${color.green(String(matches.length))} result${matches.length > 1 ? "s" : ""}`);

  const matchMap = new Map<string, FileNode>();
  const options: { label: string; value: string; hint?: string }[] = [
    { label: color.dim("Back"), value: SEARCH_BACK, hint: "return to browser" },
  ];

  for (const f of matches) {
    matchMap.set(f.path, f);
    options.push({
      label: color.green(f.name),
      value: f.path,
      hint: f.path,
    });
  }

  const choice = await select<string>({
    message: `Results for "${query}"`,
    options,
  });

  if (choice === SEARCH_BACK) return;

  const selected = matchMap.get(choice);
  if (selected) {
    await showFilePreview(rootPath, selected);
  }
}

export class ExploreCommand extends BaseCommand {
  name = "explore";
  description = "Interactively explore codebase structure";
  args = exploreArgs;
  prompts = true;

  async execute(ctx: ExploreCtx): Promise<void> {
    const config = ctx.config;
    const ignore = config.get("ignore");
    const maxDepth = ctx.args.depth || config.get("maxDepth");
    const rootPath = ctx.args.path ? resolve(ctx.args.path) : resolve(process.cwd());

    const s = spinner();
    s.start("Scanning codebase...");

    const result = await scan({
      root: rootPath,
      ignore,
      maxDepth,
      includeStats: true,
    });

    s.stop(
      `Scan complete: ${color.green(String(result.totalFiles))} files, ${color.blue(String(result.totalDirectories))} directories`,
    );

    let currentNode = result.tree;
    const pathStack: FileNode[] = [];

    while (true) {
      try {
        const { options, childMap } = buildOptions(currentNode, pathStack.length > 0);

        if ((currentNode.children ?? []).length === 0 && pathStack.length === 0) {
          log.warn("No files found in the scanned directory.");
          break;
        }

        const choice = await select<string>({
          message: currentNode.path,
          options,
        });

        if (choice === ACTION_BACK) {
          const parent = pathStack.pop();
          if (parent) currentNode = parent;
          continue;
        }

        if (choice === ACTION_SEARCH) {
          const query = await text({
            message: "Search file names",
            placeholder: "e.g. config, test, index",
          });
          if (query.trim()) {
            await searchFiles(rootPath, result.tree, query.trim());
          }
          continue;
        }

        if (choice === ACTION_STATS) {
          showStats(result, currentNode);
          continue;
        }

        const selected = childMap.get(choice);
        if (!selected) continue;

        if (selected.type === "directory") {
          pathStack.push(currentNode);
          currentNode = selected;
        } else {
          await showFilePreview(rootPath, selected);
        }
      } catch (e) {
        if (e instanceof Cancel) break;
        throw e;
      }
    }
  }
}
