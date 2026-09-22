import { Exit } from "@r5n/cli-core";
import type { ArgusConfig } from "../config/types";
import { parseConfig, parseQuestion } from "../config/validation";
import { CONFIG_VERSION } from "../constants";
import type { Question, TargetGroup } from "../domain/question";
import architecture from "./architecture.json";
import changes from "./changes.json";
import contradictions from "./comment-contradictions.json";
import comments from "./comments.json";
import explanations from "./contract-explanations.json";
import naming from "./naming.json";
import meaningfulness from "./test-meaningfulness.json";
import promises from "./test-promises.json";
import tests from "./tests.json";
import translations from "./translations.json";

export const PRESETS = {
  naming: { group: "methods", question: naming },
  comments: { group: "methods", question: comments },
  architecture: { group: "classes", question: architecture },
  tests: { group: "tests", question: tests },
  translations: { group: "translations", question: translations },
  changes: { group: "changes", question: changes },
  "comment-contradictions": { group: "methods", question: contradictions },
  "contract-explanations": { group: "methods", question: explanations },
  "test-meaningfulness": { group: "tests", question: meaningfulness },
  "test-promises": { group: "tests", question: promises },
} satisfies Record<string, { group: TargetGroup; question: unknown }>;

export type PresetName = keyof typeof PRESETS;

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
