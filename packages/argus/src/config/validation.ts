import { Exit } from "@r5n/cli-core";
import { boolean, number, object, string } from "banditypes";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from "../composition/scan-profile";
import { CONFIG_VERSION, CONTEXT_MODES, DEFAULT_MODEL, GROUPS, MAX_QUESTIONS, MAX_REQUEST_BYTES } from "../constants";
import type { ContextMode, Question } from "../domain/question";
import { upgradeBundledQuestion } from "../presets/upgrades";
import type { ArgusConfig } from "./types";

export function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Exit(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function closed(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  const parsed = record(value, label);
  for (const key of Object.keys(parsed)) {
    if (!keys.includes(key)) throw new Exit(`Unknown ${label} field: ${key}`);
    if (parsed[key] === null) throw new Exit(`${label}.${key} cannot be null`);
  }
  return parsed;
}

export function textValue(value: unknown): string {
  const parsed = string()(value);
  if (!parsed.trim()) throw new Exit("Expected a non-empty string");
  return parsed;
}

export function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Exit("Expected an array of strings");
  return value.map(textValue);
}

export function positiveInteger(value: unknown): number {
  const parsed = number()(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Exit("Expected a positive integer");
  return parsed;
}

export function probability(value: unknown): number {
  const parsed = number()(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Exit("Expected a probability between 0 and 1");
  return parsed;
}

export function parseQuestion(value: unknown): Question {
  const raw = closed(value, "question", [
    "id",
    "type",
    "instructions",
    "criteria",
    "context",
    "contextFiles",
    "include",
    "hasComments",
    "flag",
    "minConfidence",
    "minConcernProbability",
  ]);
  const question = object<Question>({
    id: textValue,
    type: (v) => {
      if (v !== "choice") throw new Exit("Question type must be choice");
      return v;
    },
    instructions: textValue,
    criteria: (v) =>
      Object.fromEntries(
        Object.entries(record(v, "criteria")).map(([key, description]) => [textValue(key), textValue(description)]),
      ),
    context: (v) => {
      const mode = v ?? "class";
      if (!CONTEXT_MODES.some((item) => item === mode)) throw new Exit(`Unknown context mode: ${String(mode)}`);
      return mode as ContextMode;
    },
    contextFiles: (v) => strings(v ?? []),
    include: (v) => strings(v ?? ["**"]),
    hasComments: (v) => boolean()(v ?? false),
    flag: (v) => strings(v ?? []),
    minConfidence: (v) => probability(v ?? 0),
    minConcernProbability: (v) => (v === undefined ? undefined : probability(v)),
  })(raw);
  if (question.minConcernProbability === undefined) delete question.minConcernProbability;
  const MIN_CHOICES = 2;
  if (Object.keys(question.criteria).length < MIN_CHOICES)
    throw new Exit(`Question ${question.id} needs at least two choices`);
  for (const choice of question.flag)
    if (!Object.hasOwn(question.criteria, choice)) throw new Exit(`Unknown flagged choice ${choice} in ${question.id}`);
  return question;
}

export function parseConfig(value: unknown): ArgusConfig {
  const raw = closed(value, "config", [
    "$schema",
    "version",
    "root",
    "model",
    "include",
    "exclude",
    "maxQuestions",
    "maxRequestBytes",
    "questions",
  ]);
  const questions = closed(raw.questions, "questions", GROUPS);
  if (raw.$schema !== undefined) textValue(raw.$schema);
  return object<ArgusConfig>({
    version: (v) => {
      if (v !== CONFIG_VERSION) throw new Exit(`Expected config version ${CONFIG_VERSION}`);
      return v;
    },
    root: textValue,
    model: (v) => textValue(v ?? DEFAULT_MODEL),
    include: (v) => strings(v ?? DEFAULT_INCLUDE),
    exclude: (v) => strings(v ?? DEFAULT_EXCLUDE),
    maxQuestions: (v) => positiveInteger(v ?? MAX_QUESTIONS),
    maxRequestBytes: (v) => positiveInteger(v ?? MAX_REQUEST_BYTES),
    questions: () =>
      Object.fromEntries(
        GROUPS.map((group) => {
          const entries = questions[group] ?? [];
          if (!Array.isArray(entries)) throw new Exit(`questions.${group} must be an array`);
          const parsed = entries.map(parseQuestion).map(upgradeBundledQuestion);
          if (new Set(parsed.map((q) => q.id)).size !== parsed.length)
            throw new Exit(`Duplicate question ID in ${group}`);
          return [group, parsed];
        }),
      ) as ArgusConfig["questions"],
  })(raw);
}
