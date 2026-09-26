import { Exit } from "@r5n/cli-core";
import type { AnalysisServices } from "../analysis/contracts";
import type { LoadedConfig } from "../config/types";
import type { Project, SourceFile } from "../domain/source-target";
import { isExcluded, matches } from "./project-files";

export class ProjectAssembler {
  private readonly patterns: string[];
  private readonly files = new Map<string, SourceFile>();
  private readonly configuration = new Map<string, string>();

  constructor(
    private readonly loaded: LoadedConfig,
    private readonly analysis: AnalysisServices,
  ) {
    this.patterns = [
      ...loaded.config.include,
      ...Object.values(loaded.config.questions).flatMap((questions) =>
        questions.flatMap((question) => question.contextFiles),
      ),
    ];
  }

  accepts(path: string): boolean {
    return (
      !isExcluded(path, this.loaded.config.exclude) && (matches(path, this.patterns) || this.analysis.needsFile(path))
    );
  }

  async add(path: string, source: string): Promise<void> {
    if (!this.accepts(path)) return;
    if (source.includes("\0")) throw new Exit(`Selected file is binary: ${path}`);
    if (this.analysis.needsFile(path)) this.configuration.set(path, source);
    if (matches(path, this.patterns)) this.files.set(path, await this.analysis.parse(path, source));
  }

  build(): Project {
    const targets = [...this.files.values()]
      .filter((file) => matches(file.path, this.loaded.config.include))
      .flatMap((file) => file.targets);
    const ids = targets.map((target) => target.id);
    if (new Set(ids).size !== ids.length) throw new Exit("Ambiguous duplicate source target IDs");
    return {
      root: this.loaded.root,
      files: this.files,
      targets,
      analysis: this.analysis,
      configuration: this.configuration,
    };
  }
}
