import { Exit } from "@r5n/cli-core";
import { object } from "banditypes";
import { probability, record, textValue } from "../../config/validation";
import type { Answer } from "../../domain/evaluation";
import type { ApiPayload } from "../../domain/review-plan";

const PROBABILITY_TOLERANCE = 0.015;
const CHOICE_TOLERANCE = 0.001;
export type ApiResponse = {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
};

export function parseAnswer(value: unknown, criteria?: Record<string, string>): Answer {
  const answer = object<Answer>({
    type: (v) => {
      if (v !== "choice") throw new Exit("Expected a choice answer");
      return v;
    },
    choice: textValue,
    confidence: probability,
    probabilities: (v) =>
      Object.fromEntries(Object.entries(record(v, "probabilities")).map(([key, score]) => [key, probability(score)])),
  })(value);
  const choices = Object.keys(answer.probabilities).sort();
  if (criteria && JSON.stringify(choices) !== JSON.stringify(Object.keys(criteria).sort()))
    throw new Exit("Answer choices do not match the question");
  const score = answer.probabilities[answer.choice];
  if (score === undefined || score + CHOICE_TOLERANCE < Math.max(...Object.values(answer.probabilities)))
    throw new Exit("Answer choice disagrees with its probabilities");
  const total = Object.values(answer.probabilities).reduce((sum, item) => sum + item, 0);
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) throw new Exit("Answer probabilities do not sum to 1");
  return answer;
}

export function parseResponse(value: unknown, payload: ApiPayload): ApiResponse {
  const raw = record(value, "API response");
  const answers = record(raw.answers, "answers");
  if (JSON.stringify(Object.keys(answers).sort()) !== JSON.stringify(Object.keys(payload.questions).sort()))
    throw new Exit("Response question IDs do not match the request");
  const usage = record(raw.usage, "usage");
  const tokens = (value: unknown) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new Exit("Invalid API token usage");
    return value;
  };
  return {
    model: textValue(raw.model),
    answers: Object.fromEntries(
      Object.entries(answers).map(([key, answer]) => [key, parseAnswer(answer, payload.questions[key]?.criteria)]),
    ),
    usage: { input_tokens: tokens(usage.input_tokens), output_tokens: tokens(usage.output_tokens) },
  };
}
