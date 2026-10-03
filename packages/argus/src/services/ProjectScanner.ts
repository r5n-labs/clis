import type { AnalysisServices } from "../analysis/contracts";
import type { LoadedConfig } from "../config/types";
import type { Project } from "../domain/source-target";
import { captureGitSnapshot } from "./git-snapshot";
import { ProjectAssembler } from "./ProjectAssembler";
import { projectPaths, readProjectFile } from "./project-files";

export class ProjectScanner {
  constructor(private readonly analysis: AnalysisServices) {}

  async scan(loaded: LoadedConfig, base?: string): Promise<Project> {
    const git = base ? await captureGitSnapshot(loaded.root, base) : undefined;
    const assembler = new ProjectAssembler(loaded, this.analysis);
    for (const path of projectPaths(loaded.root, loaded.config.exclude)) {
      if (!assembler.accepts(path)) continue;
      const file = readProjectFile(loaded.root, path);
      const mode =
        git?.honourFileMode === false ? (git.tracked.get(path) === "100755" ? "100755" : "100644") : file.mode;
      await assembler.add(path, file.source, mode);
    }
    return { ...assembler.build(), git };
  }
}
