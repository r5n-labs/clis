import type { AnalysisServices } from "../analysis/contracts";
import type { LoadedConfig } from "../config/types";
import type { Project } from "../domain/source-target";
import { ProjectAssembler } from "./ProjectAssembler";
import { projectPaths, readProjectFile } from "./project-files";

export class ProjectScanner {
  constructor(private readonly analysis: AnalysisServices) {}

  async scan(loaded: LoadedConfig): Promise<Project> {
    const assembler = new ProjectAssembler(loaded, this.analysis);
    for (const path of projectPaths(loaded.root, loaded.config.exclude)) {
      if (assembler.accepts(path)) await assembler.add(path, readProjectFile(loaded.root, path));
    }
    return assembler.build();
  }
}
