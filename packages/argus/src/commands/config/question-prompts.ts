import { confirm, log, multiselect, select } from "@r5n/cli-core";
import { parseQuestion, probability } from "../../config/validation";
import { CONTEXT_MODES } from "../../constants";
import type { Question } from "../../domain/question";
import { promptCriteria, promptList, promptNumber, promptText, validationMessage } from "./prompt-values";

const FIELDS = {
  id: "Question ID",
  instructions: "Instructions",
  criteria: "Answer choices",
  context: "Code context",
  contextFiles: "Additional context file patterns",
  include: "Target file patterns",
  hasComments: "Only targets with comments",
  flag: "Flagged answers",
  minConcernProbability: "Combined concern probability threshold",
  minConfidence: "Minimum reporting confidence",
} as const;

export async function promptQuestion(existing?: Question): Promise<Question> {
  const draft = existing
    ? structuredClone(existing)
    : parseQuestion({
        id: await promptText("Question ID"),
        type: "choice",
        instructions: await promptText("What should Jev evaluate?"),
        criteria: await promptCriteria({}),
      });
  while (true) {
    const field = await select({
      message: `Question: ${draft.id}`,
      options: [
        ...Object.entries(FIELDS).map(([value, label]) => ({ label, value: value as keyof typeof FIELDS })),
        { label: "Save question", value: "save" as const },
      ],
    });
    if (field === "save") {
      const error = validationMessage(() => parseQuestion(draft));
      if (!error) return parseQuestion(draft);
      log.warn(error);
      continue;
    }
    await editField(draft, field);
  }
}

async function editField(draft: Question, field: keyof typeof FIELDS): Promise<void> {
  switch (field) {
    case "id":
    case "instructions":
      draft[field] = await promptText(FIELDS[field], draft[field]);
      return;
    case "criteria":
      draft.criteria = await promptCriteria(draft.criteria);
      return;
    case "context":
      draft.context = await select({
        message: FIELDS[field],
        initialValue: draft.context,
        options: CONTEXT_MODES.map((value) => ({ label: value, value })),
      });
      return;
    case "contextFiles":
    case "include":
      draft[field] = await promptList(FIELDS[field], draft[field]);
      return;
    case "hasComments":
      draft.hasComments = await confirm({ message: FIELDS[field], initialValue: draft.hasComments });
      return;
    case "flag":
      draft.flag = await multiselect({
        message: FIELDS[field],
        required: false,
        initialValues: draft.flag.filter((key) => Object.hasOwn(draft.criteria, key)),
        options: Object.entries(draft.criteria).map(([value, hint]) => ({ label: value, value, hint })),
      });
      return;
    case "minConfidence":
      draft.minConfidence = await promptNumber("Minimum reporting confidence (0–1)", draft.minConfidence, probability);
      return;
    case "minConcernProbability":
      if (
        !(await confirm({
          message: "Select ambiguous candidates using combined concern probability?",
          initialValue: draft.minConcernProbability !== undefined,
        }))
      ) {
        delete draft.minConcernProbability;
        return;
      }
      draft.minConcernProbability = await promptNumber(
        "Combined concern probability (0–1)",
        draft.minConcernProbability ?? 0.5,
        probability,
      );
      return;
  }
}
