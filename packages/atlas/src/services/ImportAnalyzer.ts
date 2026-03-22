import { readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import type { FileNode } from "./CodebaseScanner";
import type { DependencyGraph, ImportInfo, PackageInfo } from "../types";

const ANALYZABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"]);

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];

// Regex patterns for import extraction
// Static imports: import { x } from "module" / import x from "module" / import "module"
const STATIC_IMPORT_RE = /^(?!\/\/|\/\*|\s*\*).*import\s+(?:(?:type\s+)?(?:\{([^}]*)\}|(\w+)(?:\s*,\s*\{([^}]*)\})?)\s+from\s+)?["']([^"']+)["']/gm;

// Dynamic imports: import("module") / await import("module")
const DYNAMIC_IMPORT_RE = /(?:^(?!\/\/|\/\*|\s*\*).*)import\s*\(\s*["']([^"']+)["']\s*\)/gm;

// Require: require("module")
const REQUIRE_RE = /(?:^(?!\/\/|\/\*|\s*\*).*)require\s*\(\s*["']([^"']+)["']\s*\)/gm;

// Re-exports: export { x } from "module" / export * from "module"
const REEXPORT_RE = /^(?!\/\/|\/\*|\s*\*).*export\s+(?:(?:type\s+)?\{([^}]*)\}|(\*))\s+from\s+["']([^"']+)["']/gm;

type RawImport = {
  modulePath: string;
  specifiers: string[];
};

function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => "\n".repeat((match.match(/\n/g) ?? []).length));
}

function parseSpecifiers(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      // Handle `x as y` => take original name
      const asMatch = /^(?:type\s+)?(\S+)(?:\s+as\s+\S+)?$/.exec(s);
      return asMatch?.[1] ?? s;
    });
}

function extractImports(source: string): RawImport[] {
  const cleaned = stripBlockComments(source);
  const imports: RawImport[] = [];

  // Static imports
  let match: RegExpExecArray | null;
  STATIC_IMPORT_RE.lastIndex = 0;
  while ((match = STATIC_IMPORT_RE.exec(cleaned)) !== null) {
    const namedImports = match[1];
    const defaultImport = match[2];
    const additionalNamed = match[3];
    const modulePath = match[4];
    if (!modulePath) continue;

    const specifiers = [
      ...parseSpecifiers(namedImports),
      ...(defaultImport ? [defaultImport] : []),
      ...parseSpecifiers(additionalNamed),
    ];
    imports.push({ modulePath, specifiers });
  }

  // Dynamic imports
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((match = DYNAMIC_IMPORT_RE.exec(cleaned)) !== null) {
    const modulePath = match[1];
    if (modulePath) {
      imports.push({ modulePath, specifiers: [] });
    }
  }

  // Require
  REQUIRE_RE.lastIndex = 0;
  while ((match = REQUIRE_RE.exec(cleaned)) !== null) {
    const modulePath = match[1];
    if (modulePath) {
      imports.push({ modulePath, specifiers: [] });
    }
  }

  // Re-exports
  REEXPORT_RE.lastIndex = 0;
  while ((match = REEXPORT_RE.exec(cleaned)) !== null) {
    const namedExports = match[1];
    const starExport = match[2];
    const modulePath = match[3];
    if (!modulePath) continue;

    const specifiers = starExport ? ["*"] : parseSpecifiers(namedExports);
    imports.push({ modulePath, specifiers });
  }

  return imports;
}

function isRelativeImport(modulePath: string): boolean {
  return modulePath.startsWith("./") || modulePath.startsWith("../");
}

function getPackageName(modulePath: string): string {
  // Scoped packages: @scope/name/rest -> @scope/name
  if (modulePath.startsWith("@")) {
    const parts = modulePath.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : modulePath;
  }
  // Regular packages: name/rest -> name
  return modulePath.split("/")[0] ?? modulePath;
}

async function fileExists(filePath: string): Promise<boolean> {
  const file = Bun.file(filePath);
  return file.exists();
}

async function resolveRelativeImport(
  importPath: string,
  sourceFile: string,
  root: string,
): Promise<string | undefined> {
  const sourceDir = dirname(join(root, sourceFile));
  const targetBase = resolve(sourceDir, importPath);

  // Try exact path first (already has extension)
  if (extname(importPath)) {
    if (await fileExists(targetBase)) {
      return relative(root, targetBase);
    }
    return undefined;
  }

  // Try with extensions
  for (const ext of RESOLVABLE_EXTENSIONS) {
    const withExt = `${targetBase}${ext}`;
    if (await fileExists(withExt)) {
      return relative(root, withExt);
    }
  }

  // Try as directory with index file
  for (const ext of RESOLVABLE_EXTENSIONS) {
    const indexPath = join(targetBase, `index${ext}`);
    if (await fileExists(indexPath)) {
      return relative(root, indexPath);
    }
  }

  return undefined;
}

async function findPackageJsonFiles(root: string, ignore: string[]): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];

  async function readDirSafe(dir: string) {
    try {
      return await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  async function walkForPackages(dir: string): Promise<void> {
    const entries = await readDirSafe(dir);

    for (const entry of entries) {
      const name = entry.name as string;
      if (ignore.includes(name)) continue;

      const fullPath = join(dir, name);

      if (entry.isFile() && name === "package.json") {
        try {
          const content = await Bun.file(fullPath).json();
          const pkgName = content.name as string | undefined;
          if (pkgName) {
            packages.push({
              name: pkgName,
              path: relative(root, dir) || ".",
              dependencies: Object.keys((content.dependencies as Record<string, string> | undefined) ?? {}),
              devDependencies: Object.keys((content.devDependencies as Record<string, string> | undefined) ?? {}),
            });
          }
        } catch {
          // Skip malformed package.json
        }
      }

      if (entry.isDirectory() && name !== "node_modules") {
        await walkForPackages(fullPath);
      }
    }
  }

  await walkForPackages(root);
  return packages;
}

function buildFileToPackageMap(files: string[], packages: PackageInfo[]): Record<string, string> {
  // Sort packages by path depth (deepest first) so nested packages win
  const sorted = [...packages].sort((a, b) => b.path.length - a.path.length);
  const mapping: Record<string, string> = {};

  for (const file of files) {
    for (const pkg of sorted) {
      const prefix = pkg.path === "." ? "" : `${pkg.path}/`;
      if (pkg.path === "." || file.startsWith(prefix)) {
        mapping[file] = pkg.name;
        break;
      }
    }
  }

  return mapping;
}

function classifyImport(
  modulePath: string,
  workspacePackageNames: Set<string>,
): "internal" | "external" | "package" {
  if (isRelativeImport(modulePath)) return "internal";

  const pkgName = getPackageName(modulePath);
  if (workspacePackageNames.has(pkgName)) return "package";

  return "external";
}

/** Flattens a FileNode tree into a list of relative file paths. */
export function flattenFileTree(node: FileNode): string[] {
  if (node.type === "file") return [node.path];

  const paths: string[] = [];
  for (const child of node.children ?? []) {
    paths.push(...flattenFileTree(child));
  }
  return paths;
}

/** Analyzes import/export relationships across a codebase. */
export async function analyzeImports(options: {
  root: string;
  files: string[];
  ignore: string[];
}): Promise<DependencyGraph> {
  const { root, files, ignore } = options;

  // Filter to analyzable files
  const analyzableFiles = files.filter((f) => ANALYZABLE_EXTENSIONS.has(extname(f)));

  // Find all packages in the workspace
  const packages = await findPackageJsonFiles(root, ignore);
  const workspacePackageNames = new Set(packages.map((p) => p.name));

  // Build file-to-package mapping
  const fileToPackage = buildFileToPackageMap(files, packages);

  // Extract imports from all files
  const imports: ImportInfo[] = [];

  const importPromises = analyzableFiles.map(async (filePath) => {
    const fullPath = join(root, filePath);
    let content: string;
    try {
      content = await Bun.file(fullPath).text();
    } catch {
      return [];
    }

    const rawImports = extractImports(content);
    const fileImports: ImportInfo[] = [];

    for (const raw of rawImports) {
      const importType = classifyImport(raw.modulePath, workspacePackageNames);

      let target: string;
      if (importType === "internal") {
        const resolved = await resolveRelativeImport(raw.modulePath, filePath, root);
        target = resolved ?? raw.modulePath;
      } else {
        target = getPackageName(raw.modulePath);
      }

      fileImports.push({
        source: filePath,
        target,
        type: importType,
        specifiers: raw.specifiers,
      });
    }

    return fileImports;
  });

  const results = await Promise.all(importPromises);
  for (const result of results) {
    imports.push(...result);
  }

  return {
    imports,
    packages,
    fileToPackage,
  };
}
