import type { Answer } from "../domain/evaluation";
import type { Question } from "../domain/question";

export function selectCandidate(question: Question, answer?: Answer) {
  const concernProbability = question.flag.reduce((sum, choice) => sum + (answer?.probabilities[choice] ?? 0), 0);
  const winningFlag = !!answer && question.flag.includes(answer.choice) && answer.confidence >= question.minConfidence;
  const uncertainFlag =
    !!answer &&
    question.flag.length > 0 &&
    question.minConcernProbability !== undefined &&
    concernProbability >= question.minConcernProbability;
  return {
    flagged: winningFlag || uncertainFlag,
    concernProbability,
    selectionReason: winningFlag
      ? "Flagged winning answer"
      : uncertainFlag
        ? "Combined probability of concerning answers"
        : null,
  };
}
