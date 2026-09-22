import { isDeepStrictEqual } from "node:util";
import type { Question } from "../domain/question";
import architecture from "./architecture.json";
import previousArchitecture from "./architecture-v1.json";
import comments from "./comments.json";
import previousComments from "./comments-v1.json";
import naming from "./naming.json";
import previousNaming from "./naming-v1.json";
import translations from "./translations.json";
import previousTranslations from "./translations-v1.json";

export function upgradeBundledQuestion(question: Question): Question {
  for (const [previous, current] of [
    [previousNaming, naming],
    [previousArchitecture, architecture],
    [previousTranslations, translations],
    [previousComments, comments],
  ] as const) {
    if (
      question.id !== previous.id ||
      question.instructions !== previous.instructions ||
      question.context !== previous.context ||
      question.hasComments !== ("hasComments" in previous && previous.hasComments) ||
      !isDeepStrictEqual(question.criteria, previous.criteria)
    )
      continue;
    return {
      ...question,
      instructions: current.instructions,
      criteria: { ...current.criteria },
      hasComments: "hasComments" in current && current.hasComments,
      flag: isDeepStrictEqual(question.flag, previous.flag) ? [...current.flag] : question.flag,
    };
  }
  return question;
}
