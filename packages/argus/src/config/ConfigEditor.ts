import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Exit } from "@r5n/cli-core";
import { JSON_INDENT } from "../constants";
import type { Question, TargetGroup } from "../domain/question";
import { presetQuestions } from "../presets";
import { loadConfigDocument } from "./loader";
import type { ArgusConfig } from "./types";
import { parseConfig, parseQuestion, record } from "./validation";

export const SETTINGS = ["root", "model", "include", "exclude", "maxQuestions", "maxRequestBytes"] as const;
export type Setting = (typeof SETTINGS)[number];

export class ConfigEditor {
  readonly path: string;
  private source: string;
  private document: Record<string, unknown>;

  constructor(configPath?: string) {
    const { path, source, document } = loadConfigDocument(configPath);
    this.path = path;
    this.source = source;
    this.document = document;
  }

  get config(): ArgusConfig {
    return parseConfig(structuredClone(this.document));
  }

  question(group: TargetGroup, id: string): Question {
    const question = this.config.questions[group].find((entry) => entry.id === id);
    if (!question) throw new Exit(`No question '${id}' in ${group}`);
    return question;
  }

  addPresets(names: string[]): boolean {
    const questions = this.config.questions;
    let changed = false;
    for (const { group, question } of presetQuestions(names)) {
      const existing = questions[group].find((entry) => entry.id === question.id);
      if (existing && !isDeepStrictEqual(existing, question))
        throw new Exit(
          `Preset conflicts with customised question '${question.id}' in ${group}`,
          "Edit or remove that question explicitly before adding this preset",
        );
      if (existing) continue;
      questions[group].push(question);
      changed = true;
    }
    if (changed) this.save({ ...this.document, questions });
    return changed;
  }

  upgradePresets(): number {
    const questions = this.config.questions;
    let changed = 0;
    for (const [legacy, replacements] of [
      ["comments", ["comment-contradictions", "contract-explanations"]],
      ["tests", ["test-meaningfulness", "test-promises"]],
    ] as const) {
      const original = presetQuestions([legacy])[0];
      if (!original) continue;
      const entries = questions[original.group];
      const existing = entries.find((entry) => entry.id === original.question.id);
      if (!existing || !isDeepStrictEqual(existing, original.question)) continue;
      const additions = presetQuestions([...replacements]).map((entry) => entry.question);
      if (
        additions.some((question) =>
          entries.some((entry) => entry.id === question.id && !isDeepStrictEqual(entry, question)),
        )
      )
        throw new Exit(
          "Focused presets conflict with customised questions",
          "Edit the conflicting question explicitly",
        );
      questions[original.group] = entries.filter((entry) => entry !== existing);
      for (const addition of additions)
        if (!questions[original.group].some((entry) => entry.id === addition.id))
          questions[original.group].push(addition);
      changed++;
    }
    if (changed) this.save({ ...this.document, questions });
    return changed;
  }

  addQuestion(group: TargetGroup, value: unknown): void {
    const question = parseQuestion(value);
    const questions = this.config.questions;
    if (questions[group].some((entry) => entry.id === question.id))
      throw new Exit(
        `Question '${question.id}' already exists in ${group}`,
        "Use 'argus config question edit' to change it",
      );
    questions[group].push(question);
    this.save({ ...this.document, questions });
  }

  editQuestion(group: TargetGroup, id: string, value: unknown): void {
    const patch = record(value, "question");
    const merged = { ...this.question(group, id), ...patch };
    if (patch.minConcernProbability === null) delete merged.minConcernProbability;
    this.replaceQuestion(group, id, merged);
  }

  replaceQuestion(group: TargetGroup, id: string, value: unknown): void {
    this.question(group, id);
    const question = parseQuestion(value);
    const questions = this.config.questions;
    questions[group] = questions[group].map((entry) => (entry.id === id ? question : entry));
    this.save({ ...this.document, questions });
  }

  removeQuestion(group: TargetGroup, id: string): void {
    this.question(group, id);
    const questions = this.config.questions;
    questions[group] = questions[group].filter((entry) => entry.id !== id);
    this.save({ ...this.document, questions });
  }

  set(key: Setting, value: unknown): void {
    this.save({ ...this.document, [key]: value });
  }

  private save(document: Record<string, unknown>): void {
    try {
      const config = parseConfig(document);
      if (!statSync(resolve(dirname(this.path), config.root)).isDirectory())
        throw new Exit("Project root must be an existing directory");
    } catch (error) {
      if (error instanceof Exit) throw error;
      throw new Exit(
        "Invalid configuration change",
        "Check field types and use a root relative to the configuration file",
      );
    }
    if (readFileSync(this.path, "utf8") !== this.source)
      throw new Exit("Configuration changed while editing", "Run the command again to load the latest configuration");
    const temporaryPath = `${this.path}.${crypto.randomUUID()}.tmp`;
    const source = `${JSON.stringify(document, null, JSON_INDENT)}\n`;
    try {
      writeFileSync(temporaryPath, source, { flag: "wx", mode: statSync(this.path).mode });
      renameSync(temporaryPath, this.path);
    } catch {
      throw new Exit(`Cannot save configuration: ${this.path}`, "Check file and directory permissions");
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    this.document = document;
    this.source = source;
  }
}
