import { Exit } from "@r5n/cli-core";
import type { AnalysisServices } from "../analysis/contracts";
import type { LoadedConfig } from "../config/types";
import type { Project, SourceTarget } from "../domain/source-target";
import { ProjectAssembler } from "../services/ProjectAssembler";
import { isExcluded, matches } from "../services/project-files";

async function git(root: string, args: string[]): Promise<string> {
  const result = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  const [out, err, code] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ]);
  if (code !== 0) throw new Exit(`Cannot collect changes: ${err.trim()}`);
  return out;
}

export async function collectChanges(loaded: LoadedConfig, project: Project, base: string): Promise<SourceTarget[]> {
  const commit = (await git(loaded.root, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`])).trim();
  const prefix = (await git(loaded.root, ["rev-parse", "--show-prefix"])).trim();
  const baseline = await baselineProject(loaded, commit, prefix, project.analysis);
  const tracked = (
    await git(loaded.root, [
      "diff",
      "--relative",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--name-only",
      "-z",
      commit,
      "--",
      ".",
    ])
  )
    .split("\0")
    .filter(Boolean);
  const untracked = (await git(loaded.root, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean);
  const targets: SourceTarget[] = [];
  for (const path of [...new Set([...tracked, ...untracked])].sort()) {
    if (!matches(path, loaded.config.include) || isExcluded(path, loaded.config.exclude)) continue;
    const file = project.files.get(path);
    const isNew = untracked.includes(path);
    if (isNew && !file) continue;
    const after = file?.source ?? "";
    const before = baseline.files.get(path)?.source ?? "";
    const diff = isNew
      ? `New file: ${path}\n${after}`
      : await git(loaded.root, [
          "diff",
          "--relative",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--unified=5",
          commit,
          "--",
          `:(literal)${path}`,
        ]);
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
    const match = /^(100644|100755) blob ([a-f0-9]+)\t(.+)$/.exec(record);
    const fullPath = match?.[3];
    if (!fullPath?.startsWith(prefix)) continue;
    const path = fullPath.slice(prefix.length);
    if (!assembler.accepts(path)) continue;
    const source = await git(loaded.root, ["show", `${commit}:${fullPath}`]);
    await assembler.add(path, source);
  }
  return assembler.build();
}
