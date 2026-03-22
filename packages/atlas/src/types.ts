import type { ScanResult } from "./services/CodebaseScanner";

export type AtlasConfig = {
  $schema?: string;
  ignore: string[];
  maxDepth: number;
  output: {
    format: "json" | "yaml";
    file?: string;
  };
};

export type ImportInfo = {
  source: string;
  target: string;
  type: "internal" | "external" | "package";
  specifiers: string[];
};

export type PackageInfo = {
  name: string;
  path: string;
  dependencies: string[];
  devDependencies: string[];
};

export type DependencyGraph = {
  imports: ImportInfo[];
  packages: PackageInfo[];
  fileToPackage: Record<string, string>;
};

export type AtlasScanResult = ScanResult & {
  dependencies?: DependencyGraph;
};
