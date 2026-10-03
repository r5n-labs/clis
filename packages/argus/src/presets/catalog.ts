import type { TargetGroup } from "../domain/question";
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
