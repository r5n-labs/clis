import type { CONTEXT_MODES, GROUPS } from "../constants";

export type TargetGroup = (typeof GROUPS)[number];
export type ContextMode = (typeof CONTEXT_MODES)[number];
export type Question = {
  id: string;
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
  context: ContextMode;
  contextFiles: string[];
  include: string[];
  hasComments: boolean;
  flag: string[];
  minConfidence: number;
  minConcernProbability?: number;
};
export type ApiQuestion = Pick<Question, "type" | "instructions" | "criteria">;
