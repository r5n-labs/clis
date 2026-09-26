import { join } from "node:path";
import { args, Exit } from "@r5n/cli-core";
import { createAnalysis } from "../composition/analysis";
import { loadConfig } from "../config/loader";
import type { LoadedConfig } from "../config/types";
import { collectChanges } from "../contexts/ChangeContextBuilder";
import { ProjectScanner } from "../services/ProjectScanner";
import { ReviewPlanner } from "../services/ReviewPlanner";
import { EvaluationStore } from "../storage/EvaluationStore";

export const reviewArgs = args({
  config: { type: "string", description: "Path to config.json (otherwise discovered upwards)" },
  base: { type: "string", description: "Git revision to compare with the working tree for change questions" },
  json: { type: "boolean", default: false, description: "Print JSON" },
});

export function loadReview(config?: string) {
  const loaded = loadConfig(config);
  const store = new EvaluationStore(join(loaded.stateDir, "cache"));
  return { loaded, store };
}

export async function prepareReview(loaded: LoadedConfig, store: EvaluationStore, base?: string) {
  if (loaded.config.questions.changes.length && !base)
    throw new Exit(
      "Change questions require --base <git-revision>",
      "Supply a base revision or remove questions.changes from the config",
    );
  const project = await new ProjectScanner(createAnalysis()).scan(loaded);
  if (loaded.config.questions.changes.length && base)
    project.targets.push(...(await collectChanges(loaded, project, base)));
  return new ReviewPlanner(store).plan(project, loaded.config);
}
