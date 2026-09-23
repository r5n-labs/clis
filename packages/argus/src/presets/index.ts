import { Exit } from "@r5n/cli-core";
import type { ArgusConfig } from "../config/types";
import { parseConfig, parseQuestion } from "../config/validation";
import { CONFIG_VERSION } from "../constants";
import type { Question, TargetGroup } from "../domain/question";
import { PRESETS, type PresetName } from "./catalog";

export { PRESETS, type PresetName } from "./catalog";

export function presetQuestions(names: string[]) {
  const expanded = names.flatMap((name) =>
    name === "all" ? Object.keys(PRESETS).filter((key) => key !== "comments" && key !== "tests") : [name],
  );
  return expanded.map((name) => {
    if (!Object.hasOwn(PRESETS, name))
      throw new Exit(`Unknown preset: ${name}`, `Choose ${Object.keys(PRESETS).join(", ")} or all`);
    const preset = PRESETS[name as PresetName];
    return { group: preset.group, question: parseQuestion(preset.question) };
  });
}

export function defaultConfig(root: string, preset: "naming" | "all"): ArgusConfig {
  const questions: Partial<Record<TargetGroup, Question[]>> = {};
  for (const { group, question } of presetQuestions([preset])) {
    questions[group] ??= [];
    questions[group].push(question);
  }
  return parseConfig({ version: CONFIG_VERSION, root, questions });
}
