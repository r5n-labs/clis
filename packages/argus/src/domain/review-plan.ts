import type { Evaluation } from "./evaluation";
import type { ApiQuestion, Question } from "./question";
import type { SourceTarget } from "./source-target";

export type ReviewContext = {
  language: string;
  path: string;
  source: string;
  related: { path: string; source: string }[];
  unresolved?: { path: string; expressions: string[] }[];
  referenceScope?: string;
  notes?: string[];
};
export type ReviewItem = {
  target: SourceTarget;
  question: Question;
  apiQuestion: ApiQuestion;
  context: ReviewContext;
  inputHash: string;
  questionHash: string;
  evaluation?: Evaluation;
  blocked?: string;
  expanded?: boolean;
  contextNote?: string;
};
export type ReviewPlan = {
  root: string;
  model: string;
  items: ReviewItem[];
  files: number;
  targets: number;
  refresh?: () => void;
};
export type RequestBatch = { id: string; items: ReviewItem[]; payload: ApiPayload };
export type ApiPayload = { model: string; state: ReviewContext; questions: Record<string, ApiQuestion> };
