export type Answer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
export type Evaluation = {
  version: number;
  inputHash: string;
  questionHash: string;
  targetId: string;
  questionId: string;
  answer: Answer;
  model: string;
  evaluatedAt: string;
  requestId: string;
};
