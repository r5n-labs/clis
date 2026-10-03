import { Exit } from "@r5n/cli-core";
import type { AnalysisServices } from "../analysis/contracts";
import type { LoadedConfig } from "../config/types";
import type { Project, SourceTarget } from "../domain/source-target";
import { git } from "../services/git-snapshot";
import { ProjectAssembler } from "../services/ProjectAssembler";
import { isExcluded, matches } from "../services/project-files";
import { changeDiff } from "./change-diff";

export async function collectChanges(loaded: LoadedConfig, project: Project): Promise<SourceTarget[]> {
  if (!project.git) throw new Exit("Cannot collect changes: scan the project with a Git base revision");
  const { commit } = project.git;
  const baseline = await baselineProject(loaded, commit, project.git.prefix, project.analysis);
  const targets: SourceTarget[] = [];
  for (const path of [...new Set([...project.git.changed, ...project.git.untracked])].sort()) {
    if (!matches(path, loaded.config.include) || isExcluded(path, loaded.config.exclude)) continue;
    const file = project.git.tracked.has(path) || project.git.untracked.has(path) ? project.files.get(path) : undefined;
    if (!file && project.git.skipWorktree.has(path)) continue;
    const previous = baseline.files.get(path);
    if (!previous && !file) continue;
    const beforeMode = baseline.fileModes.get(path) ?? "100644";
    const afterMode = project.fileModes.get(path) ?? "100644";
    if (previous && file && previous.source === file.source && beforeMode === afterMode) continue;
    const after = file?.source ?? "";
    const before = previous?.source ?? "";
    const diff = await changeDiff(
      path,
      previous ? { source: before, mode: beforeMode } : undefined,
      file ? { source: after, mode: afterMode } : undefined,
    );
    const source = JSON.stringify({ base: commit, diff, before, after });
    targets.push({
      id: `changes:${path}`,
      group: "changes",
      path,
      owner: path,
      name: path,
      line: 1,
      endLine: after.split("\n").length,
      source,
      comments: "",
      declarations: [],
      references: file?.references ?? [],
      calls: [],
      changeContext: { before: baseline, after: project },
    });
  }
  return targets;
}

async function baselineProject(
  loaded: LoadedConfig,
  commit: string,
  prefix: string,
  analysis: AnalysisServices,
): Promise<Project> {
  const tree = await git(loaded.root, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  const assembler = new ProjectAssembler(loaded, analysis);
  for (const record of tree.split("\0")) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
    const fullPath = match?.[3];
    if (!fullPath?.startsWith(prefix)) continue;
    const path = fullPath.slice(prefix.length);
    if (!assembler.accepts(path)) continue;
    const source = await git(loaded.root, ["show", `${commit}:${fullPath}`]);
    await assembler.add(path, source, match?.[1] === "100755" ? "100755" : "100644");
  }
  return assembler.build();
}
