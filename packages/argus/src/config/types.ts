import type { Question, TargetGroup } from "../domain/question";

export type ArgusConfig = {
  version: number;
  root: string;
  model: string;
  include: string[];
  exclude: string[];
  maxQuestions: number;
  maxRequestBytes: number;
  questions: Record<TargetGroup, Question[]>;
};
export type LoadedConfig = { config: ArgusConfig; path: string; root: string; stateDir: string };
